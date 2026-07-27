/**
 * visitor-tracker Worker  (D1 live-state edition)
 * Replaces: cursor_track.php
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED FROM THE PREVIOUS VERSION (and why the old one was broken):
 *
 *   The previous version stored ALL live visitors in a single Cloudflare KV key
 *   ("live_state"), read-modify-written on every ping. That can't work, because
 *   KV is *eventually consistent* and edge-caches reads for up to ~60 seconds.
 *   A ping would write and return {ok:true}, but the dashboard's GET would read
 *   a stale (or empty) cached copy and get {} — so visitors never appeared.
 *   KV is simply the wrong tool for sub-second live state: its reads are at best
 *   ~60s fresh, the single-key read-modify-write is racy under concurrency, and
 *   the free tier only allows 1,000 KV writes/day (one put per ping exhausts
 *   that in ~80 minutes regardless).
 *
 *   FIX: live state now lives in D1 (SQLite), which is strongly consistent —
 *   write a row, read it back immediately, and you see it. No KV, no race, no
 *   edge-cache lag, and no list() daily-limit problem. Permanent history
 *   (visitor_log, session_snapshots) was already in D1 and is unchanged.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Storage mapping:
 *   - Live ephemeral visitor state (was the single KV "live_state" key)
 *       -> D1 table "live_visitors": one row per vid, UPSERTed on each ping.
 *          A row counts as "live" if its updated_at is within LIVE_TTL_MS.
 *   - Permanent visit history (visitor_log, session_snapshots) -> D1 (unchanged)
 *
 * Bindings required in wrangler.toml:
 *   - D1:  binding = "phobiafree_db"  (the existing phobiafree-db database)
 *   The old KV binding (VISITORS_KV) is no longer used and can be removed.
 *
 * The live_visitors table is created automatically on the first request, so no
 * manual migration is strictly required. If you'd rather create it yourself:
 *   wrangler d1 execute phobiafree-db --remote --command "CREATE TABLE IF NOT EXISTS live_visitors (vid TEXT PRIMARY KEY, data TEXT NOT NULL, pings INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_live_updated ON live_visitors(updated_at);"
 *
 * Routes (unchanged):
 *   POST /track?event=1   -> event ping (adds a "page/section visited" label)
 *   POST /track           -> regular cursor/position ping
 *   GET  /track           -> returns all currently-active visitors (dashboard polls this)
 */

const LIVE_TTL_MS = 8000;       // fallback if the browser never sends leave (crash/kill)
// iOS Safari throttles timers hard while the soft keyboard is open — pings can
// gap well past 8s during an active chat. Keep chat sessions on the board longer.
const LIVE_TTL_CHAT_MS = 45000;
const CLEANUP_AGE_MS = 60000;   // during sweep, delete rows older than this

// Bots/crawlers/monitors that render JS can otherwise show up as "live visitors".
// Drop any ping whose User-Agent matches these, and any request with no UA.
const BOT_UA = /bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|slackbot|vkshare|w3c_validator|headless|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|gtmetrix|pingdom|uptimerobot|statuscake|monitor|curl|wget|python-requests|python-urllib|httpx|aiohttp|axios|node-fetch|go-http-client|okhttp|java\/|scrapy|apache-httpclient/i;

function isBot(request) {
  const ua = request.headers.get('user-agent') || '';
  return !ua || BOT_UA.test(ua);
}

// Set once per isolate so we don't issue CREATE TABLE on every request.
let schemaReady = false;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function cleanVid(raw) {
  return (raw || '').replace(/[^a-z0-9_]/gi, '');
}

function getIP(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

function getLocation(request) {
  const cf = request.cf;
  if (!cf) return '';
  const parts = [cf.city, cf.region, cf.country].filter(Boolean);
  return parts.join(', ');
}

// Create the live_visitors table + index once per isolate (idempotent, cheap).
async function ensureSchema(env) {
  if (schemaReady) return;
  try {
    await env.phobiafree_db
      .prepare('CREATE TABLE IF NOT EXISTS live_visitors (vid TEXT PRIMARY KEY, data TEXT NOT NULL, pings INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)')
      .run();
    await env.phobiafree_db
      .prepare('CREATE INDEX IF NOT EXISTS idx_live_updated ON live_visitors(updated_at)')
      .run();
    await env.phobiafree_db.prepare(`
      CREATE TABLE IF NOT EXISTS page_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vid TEXT,
        ip TEXT,
        location TEXT,
        device TEXT,
        page TEXT,
        path TEXT,
        gclid TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_term TEXT,
        utm_content TEXT,
        referrer TEXT,
        interacted INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    await env.phobiafree_db
      .prepare('CREATE INDEX IF NOT EXISTS idx_page_hits_created ON page_hits(created_at)')
      .run();
    try {
      await env.phobiafree_db.prepare('ALTER TABLE page_hits ADD COLUMN archived INTEGER DEFAULT 0').run();
    } catch (_) { /* exists */ }
    try {
      await env.phobiafree_db.prepare('ALTER TABLE visitor_log ADD COLUMN archived INTEGER DEFAULT 0').run();
    } catch (_) { /* exists */ }
    schemaReady = true;
  } catch (e) {
    // If this fails, the individual queries below will surface the real error.
    console.log('ensureSchema failed:', String(e));
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const isEventPing = url.searchParams.get('event') !== null;

    try {
      await ensureSchema(env);

      if (request.method === 'POST' && url.searchParams.get('leave') !== null) {
        return await handleLeave(request, env);
      }
      if (request.method === 'POST' && url.searchParams.get('hit') !== null) {
        return await handlePageHit(request, env);
      }
      if (request.method === 'POST' && isEventPing) {
        return await handleEventPing(request, env);
      }
      if (request.method === 'POST') {
        return await handleTrackerPing(request, env);
      }
      if (request.method === 'GET') {
        return await handleGetActiveVisitors(env);
      }
      return json({ ok: false, error: 'method not allowed' }, 405);
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  },
};

// ── PAGE HIT — every landing, even with zero mouse/scroll (Ads reconciliation)
async function handlePageHit(request, env) {
  if (isBot(request)) return json({ ok: false, reason: 'bot' });
  const data = await request.json().catch(() => null);
  if (!data || !data.vid) return json({ ok: false });

  const vid = cleanVid(data.vid);
  const ip = getIP(request);
  const location = getLocation(request);
  const device = (data.device || 'unknown').toString().slice(0, 40);
  const page = (data.page || '').toString().slice(0, 80);
  const path = (data.path || '').toString().slice(0, 200);
  const gclid = (data.gclid || '').toString().slice(0, 200);
  const utm_source = (data.utm_source || '').toString().slice(0, 80);
  const utm_medium = (data.utm_medium || '').toString().slice(0, 80);
  const utm_campaign = (data.utm_campaign || '').toString().slice(0, 120);
  const utm_term = (data.utm_term || '').toString().slice(0, 200);
  const utm_content = (data.utm_content || '').toString().slice(0, 120);
  const referrer = (data.referrer || '').toString().slice(0, 400);
  const interacted = data.interacted ? 1 : 0;

  try {
    await env.phobiafree_db.prepare(`
      INSERT INTO page_hits (
        vid, ip, location, device, page, path,
        gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        referrer, interacted, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      vid, ip, location, device, page, path,
      gclid || null, utm_source || null, utm_medium || null,
      utm_campaign || null, utm_term || null, utm_content || null,
      referrer || null, interacted
    ).run();
  } catch (e) {
    console.log('page_hits insert failed:', String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
  return json({ ok: true, hit: true });
}

// ── LEAVE — visitor closed/left the page; drop live card immediately ────────
async function handleLeave(request, env) {
  let vid = '';
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json') || ct.includes('text/plain') || !ct) {
    const text = await request.text().catch(() => '');
    try {
      const body = text ? JSON.parse(text) : null;
      vid = cleanVid(body && body.vid);
    } catch {
      vid = '';
    }
  } else {
    const form = await request.formData().catch(() => null);
    vid = cleanVid(form && form.get('vid'));
  }
  if (vid) {
    await env.phobiafree_db
      .prepare('DELETE FROM live_visitors WHERE vid = ?')
      .bind(vid)
      .run();
  }
  return json({ ok: true });
}

// ── EVENT TRACKING (unchanged) ──────────────────────────────────────────────
// Accepts JSON or form-encoded body; appends a "★ label" to visitor_log.pages.
async function handleEventPing(request, env) {
  if (isBot(request)) return json({ ok: false, reason: 'bot' });
  let vid = '';
  let eventLabel = '';

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    vid = cleanVid(body.vid);
    eventLabel = (body.event || '').toString();
  } else {
    const form = await request.formData();
    vid = cleanVid(form.get('vid'));
    eventLabel = (form.get('event') || '').toString();
  }

  if (vid && eventLabel) {
    const label = '★ ' + eventLabel.trim().slice(0, 60);
    const row = await env.phobiafree_db
      .prepare('SELECT pages FROM visitor_log WHERE vid = ?')
      .bind(vid)
      .first();

    if (row) {
      let pages = [];
      try { pages = JSON.parse(row.pages || '[]'); } catch { pages = []; }
      pages.push(label);
      pages = pages.slice(-20);
      await env.phobiafree_db
        .prepare("UPDATE visitor_log SET pages = ?, last_seen = datetime('now') WHERE vid = ?")
        .bind(JSON.stringify(pages), vid)
        .run();
    }
  }

  return json({ ok: true });
}

// ── REGULAR TRACKER POST ────────────────────────────────────────────────────
async function handleTrackerPing(request, env) {
  if (isBot(request)) return json({ ok: false, reason: 'bot' });
  const data = await request.json().catch(() => null);
  if (!data || !data.vid) return json({ ok: false });
  // The tracker only pings AFTER a real interaction, so every legit ping carries
  // interacted:1. Reject anything without it — that's a direct-POST bot, a
  // residential-proxy scraper, or a stale pre-fix tab that never engaged.
  if (!data.interacted) return json({ ok: false, reason: 'no-interaction' });

  const vid = cleanVid(data.vid);
  // If they landed as a ghost hit and later engaged, flag the recent hit rows.
  try {
    await env.phobiafree_db
      .prepare("UPDATE page_hits SET interacted = 1 WHERE vid = ? AND interacted = 0 AND created_at >= datetime('now','-6 hours')")
      .bind(vid)
      .run();
  } catch (e) {}

  const ip = getIP(request);
  const vw = parseInt(data.vw || 0, 10);
  const vh = parseInt(data.vh || 0, 10);

  // Filter out dashboard mirror iframes when they paint at card size (~280).
  // Do NOT raise this toward phone widths (375–390) — that drops real iPhones.
  // Live cards already load pages with ?notrack=1; this is a safety net only.
  if (
    vw <= 280 ||
    (vw === 485 && vh === 594) ||
    (vw === 524 && vh === 554) ||
    (vw === 570 && vh === 595)
  ) {
    return json({ ok: false, reason: 'iframe' });
  }

  const now = Date.now();

  // ── Read this visitor's prior live row from D1 (strongly consistent) ──
  //    (replaces reading the single KV "live_state" key)
  let prior = null;
  const priorRow = await env.phobiafree_db
    .prepare('SELECT data, pings FROM live_visitors WHERE vid = ?')
    .bind(vid)
    .first();
  if (priorRow) {
    let pd = {};
    try { pd = JSON.parse(priorRow.data); } catch { pd = {}; }
    prior = pd;
    prior.pings = priorRow.pings;
  }

  const location = (prior && prior.location) || getLocation(request);
  const storedFirstLoad = (prior && prior.first_load) || 0;
  const incomingFirstLoad = parseInt(data.first_load || 0, 10);
  const first_load = incomingFirstLoad > storedFirstLoad ? incomingFirstLoad : storedFirstLoad;
  const priorPings = (prior && prior.pings) || 0;
  const pings = priorPings + 1;

  // Normalize FAQ open indices (which <details class="faq"> are expanded).
  const openFaqs = Array.isArray(data.openFaqs)
    ? data.openFaqs.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 0)
    : [];

  // Visitor on-site chat panel state (open + drag position + recent messages).
  const chatOpen = !!data.chatOpen;
  const chatLeftPct = data.chatLeftPct == null ? null : Number(data.chatLeftPct);
  const chatTopPct = data.chatTopPct == null ? null : Number(data.chatTopPct);
  const chatMsgs = Array.isArray(data.chatMsgs)
    ? data.chatMsgs.slice(-40).map((m) => ({
        from: (m && m.from) === 'visitor' ? 'visitor' : 'steven',
        type: (m && m.type) ? String(m.type).slice(0, 20) : 'text',
        text: m && m.text != null ? String(m.text).slice(0, 500) : '',
        url: m && m.url ? String(m.url).slice(0, 500) : '',
        id: m && m.id != null ? m.id : null,
      }))
    : [];

  // Exact same shape the dashboard already reads — nothing downstream changes.
  const visitorState = {
    x: parseFloat(data.x || 0),
    y: parseFloat(data.y || 0),
    scrollY: parseInt(data.scrollY || 0, 10),
    scrollPct: parseFloat(data.scrollPct || 0),
    modalScroll: !!data.modalScroll,
    openFaqs,
    chatOpen,
    chatLeftPct: Number.isFinite(chatLeftPct) ? chatLeftPct : null,
    chatTopPct: Number.isFinite(chatTopPct) ? chatTopPct : null,
    chatMsgs,
    vw, vh,
    section: (data.section || '').toString(),
    page: (data.page || 'home').toString(),
    device: (data.device || 'unknown').toString(),
    ip,
    location,
    first: (prior && prior.first) || now,
    first_load,
    pings,
    t: now,
    events: Array.isArray(data.events) && data.events.length ? data.events : [],
  };

  // ── Upsert the live row (one row per visitor). Strongly consistent, so the
  //    dashboard's GET is guaranteed to see this immediately. ──
  await env.phobiafree_db
    .prepare(
      'INSERT INTO live_visitors (vid, data, pings, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(vid) DO UPDATE SET data = excluded.data, pings = excluded.pings, updated_at = excluded.updated_at'
    )
    .bind(vid, JSON.stringify(visitorState), pings, now)
    .run();

  // Occasionally sweep out long-dead rows so the table stays small. (~1 in 50
  // pings, so it's cheap; the GET already ignores anything older than the TTL.)
  if (Math.random() < 0.02) {
    try {
      await env.phobiafree_db
        .prepare('DELETE FROM live_visitors WHERE updated_at < ?')
        .bind(now - CLEANUP_AGE_MS)
        .run();
    } catch (e) {}
  }

  // ── Permanent history to D1 ──────────────────────────────────────────────
  //    Record whenever this visitor is already known OR has proven real
  //    (>= 2 pings). The ">= 2" gate keeps one-shot phantoms out; once a
  //    session exists, later page navigations (which delete the live row and
  //    restart the ping counter) must NOT pause recording — otherwise
  //    switching phobias leaves a hole in the film, and watching Replay on
  //    the dashboard would look like "recording stopped."
  const existing = await env.phobiafree_db
    .prepare('SELECT id, pages, total_seconds FROM visitor_log WHERE vid = ?')
    .bind(vid)
    .first();

  if (pings >= 2 || existing) {
    try {
      const nowIso = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
      const page = (data.page || data.section || '').toString();

      if (existing) {
        let pages = [];
        try { pages = JSON.parse(existing.pages || '[]'); } catch { pages = []; }
        if (page && !pages.includes(page)) pages.push(page);
        await env.phobiafree_db
          .prepare('UPDATE visitor_log SET last_seen = ?, total_seconds = ?, pages = ? WHERE vid = ?')
          .bind(nowIso, existing.total_seconds + 5, JSON.stringify(pages), vid)
          .run();
      } else {
        await env.phobiafree_db
          .prepare('INSERT INTO visitor_log (vid, ip, location, device, first_seen, last_seen, total_seconds, pages) VALUES (?, ?, ?, ?, ?, ?, 5, ?)')
          .bind(vid, ip, location, visitorState.device, nowIso, nowIso, JSON.stringify(page ? [page] : []))
          .run();
      }

      const snapshot = {
        x: visitorState.x, y: visitorState.y,
        scrollY: visitorState.scrollY, scrollPct: visitorState.scrollPct,
        modalScroll: !!visitorState.modalScroll,
        openFaqs: visitorState.openFaqs || [],
        chatOpen: !!visitorState.chatOpen,
        chatLeftPct: visitorState.chatLeftPct,
        chatTopPct: visitorState.chatTopPct,
        chatMsgs: visitorState.chatMsgs || [],
        vw, vh,
        section: visitorState.section, page: visitorState.page, device: visitorState.device,
        location, first: visitorState.first, first_load,
        t: now,
        events: data.events || [],
      };
      await env.phobiafree_db
        .prepare('INSERT INTO session_snapshots (vid, snapshot, created_at) VALUES (?, ?, ?)')
        .bind(vid, JSON.stringify(snapshot), nowIso)
        .run();
    } catch (dbErr) {
      console.log('D1 WRITE FAILED:', String(dbErr));
    }
  }

  return json({ ok: true });
}

// ── GET — return all currently active visitors ─────────────────────────────
// One indexed SELECT against D1. Strongly consistent, so a ping written a
// moment ago is guaranteed to show up. No KV, no list(), no edge-cache lag.
async function handleGetActiveVisitors(env) {
  const now = Date.now();
  const result = {};
  try {
    // Pull a wider window, then apply per-row TTL (longer while chat is open).
    const { results } = await env.phobiafree_db
      .prepare('SELECT vid, data, updated_at FROM live_visitors WHERE updated_at > ?')
      .bind(now - LIVE_TTL_CHAT_MS)
      .all();
    if (results) {
      for (const row of results) {
        try {
          const data = JSON.parse(row.data);
          const ttl = data && data.chatOpen ? LIVE_TTL_CHAT_MS : LIVE_TTL_MS;
          if ((row.updated_at || 0) > now - ttl) result[row.vid] = data;
        } catch (e) { /* skip a malformed row rather than failing the whole poll */ }
      }
    }
  } catch (e) {
    // Table missing or query error — return empty instead of a 500.
    return json({});
  }
  return json(result);
}
