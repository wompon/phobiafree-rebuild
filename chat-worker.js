/**
 * chat Worker  — replaces the old file-based chat_handler.php
 *
 * The dashboard (visitors.html) already speaks this contract:
 *   SEND:  POST  /            body {vid, from, text, type?, url?}   -> {ts}
 *   POLL:  GET   /?vid=&since=                                      -> {ts, messages:[{id,from,type,text,url,t}]}
 *
 *   - "from" is 'steven' for Steven's replies, 'visitor' for the website visitor.
 *   - "since" is a unix-seconds cursor. Poll returns messages with t > since,
 *      plus the newest t as the next cursor. First load uses since=0 (full history).
 *
 * Storage: D1 table "chat_messages" (auto-created on first request).
 * Binding required in wrangler.toml:  D1 binding = "phobiafree_db"
 *
 * Twilio SMS: a visitor message texts Steven (with a #code); Steven texts back
 * (POST /sms webhook) and the reply lands in that visitor's chat thread.
 */

let schemaReady = false;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
function json(d, status = 200) {
  return new Response(JSON.stringify(d), { status, headers: cors() });
}
function cleanVid(raw) {
  return (raw || '').replace(/[^a-z0-9_]/gi, '');
}

async function ensureSchema(env) {
  if (schemaReady) return;
  try {
    await env.phobiafree_db
      .prepare('CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, vid TEXT NOT NULL, sender TEXT NOT NULL, mtype TEXT NOT NULL DEFAULT "text", body TEXT NOT NULL DEFAULT "", url TEXT, t INTEGER NOT NULL)')
      .run();
    await env.phobiafree_db
      .prepare('CREATE INDEX IF NOT EXISTS idx_chat_vid_t ON chat_messages(vid, t)')
      .run();
    await env.phobiafree_db
      .prepare('CREATE TABLE IF NOT EXISTS chat_status (id INTEGER PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL)')
      .run();
    schemaReady = true;
  } catch (e) {
    console.log('chat ensureSchema failed:', String(e));
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    try {
      await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith('/pay/')) return await handlePay(path, url, env);
      if (path.startsWith('/file/')) return await handleFileGet(path, env);
      if (path.startsWith('/admin/')) return await handleAdmin(path, request, env);
      if (path.endsWith('/sms')) return await handleInboundSms(request, env);
      if (path.endsWith('/status')) {
        if (request.method === 'POST') return await handleStatusSet(request, env);
        return await handleStatusGet(env);
      }
      if (request.method === 'POST') {
        const ct = request.headers.get('content-type') || '';
        if (ct.includes('multipart/form-data')) return await handleUpload(request, env, url);
        return await handleSend(request, env, ctx);
      }
      if (request.method === 'GET') return await handlePoll(request, env);
      return json({ ok: false, error: 'method not allowed' }, 405);
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  },
};

// ── STATUS ──────────────────────────────────────────────────────────────────
// GET  /status            -> { status }   (defaults to 'offline' until set)
// POST /status {status}   -> { ok:true }  (dashboard's Online/Offline button)
async function handleStatusGet(env) {
  const row = await env.phobiafree_db
    .prepare('SELECT status, updated_at FROM chat_status WHERE id = 1')
    .first();
  let status = (row && row.status) || 'offline';
  // Dashboard must heartbeat; stale online presence becomes offline.
  if (
    row &&
    (status === 'online' || status === 'online_cam') &&
    Number(row.updated_at || 0) < Math.floor(Date.now() / 1000) - 90
  ) {
    status = 'offline';
    await env.phobiafree_db
      .prepare(
        'INSERT INTO chat_status (id, status, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
      )
      .bind('offline', Math.floor(Date.now() / 1000))
      .run();
  }
  return json({ status });
}

async function handleStatusSet(request, env) {
  let status = 'offline';
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json') || ct.includes('text/plain') || !ct) {
    const text = await request.text().catch(() => '');
    try {
      const data = text ? JSON.parse(text) : null;
      status = ((data && data.status) || 'offline').toString();
    } catch {
      status = 'offline';
    }
  } else {
    const form = await request.formData().catch(() => null);
    const action = form?.get('action')?.toString() || 'offline';
    status = action;
  }
  const allowed = ['online', 'online_cam', 'incall', 'offline'];
  if (!allowed.includes(status)) status = 'offline';
  status = status.slice(0, 20);
  await env.phobiafree_db
    .prepare('INSERT INTO chat_status (id, status, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at')
    .bind(status, Math.floor(Date.now() / 1000))
    .run();
  return json({ ok: true, status });
}

// ── FILE UPLOAD / SERVE (R2) ─────────────────────────────────────────────────
// POST  /            multipart with field "file"  -> { ok:true, url, name }
// GET   /file/<key>                                -> the stored file
async function handleUpload(request, env, url) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return json({ ok: false, error: 'no file' });

    const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const key = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safe;
    const body = await file.arrayBuffer();

    await env.CHAT_FILES.put(key, body, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    return json({ ok: true, url: url.origin + '/file/' + key, name: file.name || safe });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
}

async function handleFileGet(path, env) {
  const key = decodeURIComponent(path.slice('/file/'.length));
  if (!key) return new Response('not found', { status: 404, headers: cors() });

  const obj = await env.CHAT_FILES.get(key);
  if (!obj) return new Response('not found', { status: 404, headers: cors() });

  const headers = new Headers();
  headers.set('content-type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=31536000');
  headers.set('access-control-allow-origin', '*');
  return new Response(obj.body, { headers });
}

// ── SEND ────────────────────────────────────────────────────────────────────
async function handleSend(request, env, ctx) {
  const data = await request.json().catch(() => null);
  if (!data) return json({ ok: false, error: 'bad json' });

  const vid = cleanVid(data.vid);
  const from = (data.from || 'visitor').toString().slice(0, 20);
  const type = (data.type || 'text').toString().slice(0, 20);
  const text = (data.text || '').toString().slice(0, 1000);
  const url = data.url ? data.url.toString().slice(0, 500) : null;
  // source: where the message originated — 'visitor' (client), 'dashboard'
  // (secretary), or 'sms' (Steven's phone). Defaults sensibly from `from`.
  const source = (data.source || (from === 'steven' ? 'dashboard' : 'visitor')).toString().slice(0, 20);
  if (!vid || (!text && !url)) return json({ ok: false, error: 'missing vid/text' });

  const t = Math.floor(Date.now() / 1000);

  const ins = await env.phobiafree_db
    .prepare('INSERT INTO chat_messages (vid, sender, mtype, body, url, t) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(vid, from, type, text, url, t)
    .run();
  const id = ins && ins.meta ? ins.meta.last_row_id : undefined;

  // Mirror to Steven's phone for everything EXCEPT messages he sent from his
  // own phone (source 'sms') — so he sees the client + secretary, never himself.
  if (source !== 'sms') {
    const notify = notifySteven(env, vid, text, url, from);
    if (ctx && ctx.waitUntil) ctx.waitUntil(notify);
    else await notify;
  }

  return json({ ts: t, id });
}

// ── POLL ──────────────────────────────────────────────────────────────────--
async function handlePoll(request, env) {
  const url = new URL(request.url);
  const vid = cleanVid(url.searchParams.get('vid'));
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;

  if (!vid) return json({ ts: since, messages: [] });

  const { results } = await env.phobiafree_db
    .prepare('SELECT id, sender, mtype, body, url, t FROM chat_messages WHERE vid = ? AND t > ? ORDER BY t ASC, id ASC LIMIT 200')
    .bind(vid, since)
    .all();

  const messages = (results || []).map((r) => ({
    id: r.id,
    from: r.sender,
    type: r.mtype,
    text: r.body,
    url: r.url,
    t: r.t,
  }));

  const ts = messages.length ? messages[messages.length - 1].t : since;
  return json({ ts, messages });
}

// ── TWILIO SMS ───────────────────────────────────────────────────────────────
// Short per-visitor code = first 4 hex of SHA-256(vid). Lets Steven reply to a
// specific visitor by texting "#abcd your message".
async function vidCode(vid) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(vid));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 4);
}

async function sendSMS(env, to, body) {
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !env.TWILIO_FROM || !to) return false;
  try {
    const resp = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: body }).toString(),
    });
    return resp.ok;
  } catch (e) {
    console.log('sendSMS failed:', String(e));
    return false;
  }
}

async function notifySteven(env, vid, text, url, from) {
  try {
    if (!env.STEVEN_PHONE) return;
    const code = await vidCode(vid);
    const t = (text && text.trim()) ? text.trim() : (url ? 'sent a file' : '');
    // Label who is speaking so the 3-way thread is readable on the phone.
    const who = from === 'steven' ? ('👩 Secretary re ' + vid) : ('💬 ' + vid);
    const sms = who + '  [#' + code + ']\n"' + t.slice(0, 140) + '"\nReply: #' + code + ' your message';
    await sendSMS(env, env.STEVEN_PHONE, sms);
  } catch (e) {
    console.log('notifySteven failed:', String(e));
  }
}

// POST /sms — Twilio inbound webhook for Steven's text replies.
async function handleInboundSms(request, env) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const xmlHeaders = { 'Content-Type': 'text/xml' };

  let body = '';
  try {
    const form = await request.formData();
    body = (form.get('Body') || '').toString().trim();
  } catch (e) {}
  if (!body) return new Response(xml, { headers: xmlHeaders });

  let targetVid = null;
  let replyText = body;

  const m = body.match(/^#([a-f0-9]{4})\s+([\s\S]+)$/i);
  if (m) {
    const code = m[1].toLowerCase();
    replyText = m[2].trim();
    const { results } = await env.phobiafree_db.prepare('SELECT DISTINCT vid FROM chat_messages').all();
    for (const r of (results || [])) {
      if ((await vidCode(r.vid)) === code) { targetVid = r.vid; break; }
    }
  }

  if (!targetVid) {
    const row = await env.phobiafree_db
      .prepare("SELECT vid, t FROM chat_messages WHERE sender = 'visitor' ORDER BY t DESC LIMIT 1")
      .first();
    if (row && (Math.floor(Date.now() / 1000) - row.t < 3600)) targetVid = row.vid;
  }

  if (targetVid && replyText) {
    await env.phobiafree_db
      .prepare("INSERT INTO chat_messages (vid, sender, mtype, body, url, t) VALUES (?, 'steven', 'text', ?, NULL, ?)")
      .bind(targetVid, replyText.slice(0, 1000), Math.floor(Date.now() / 1000))
      .run();
  }

  return new Response(xml, { headers: xmlHeaders });
}

// ── ADMIN (login + consultations) ────────────────────────────────────────────
let adminColsReady = false;
async function ensureAdminCols(env) {
  if (adminColsReady) return;
  try { await env.phobiafree_db.prepare("ALTER TABLE consultations ADD COLUMN status TEXT DEFAULT 'new'").run(); } catch (e) {}
  try { await env.phobiafree_db.prepare("CREATE TABLE IF NOT EXISTS app_settings (k TEXT PRIMARY KEY, v TEXT)").run(); } catch (e) {}
  try { await env.phobiafree_db.prepare("CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, phobia TEXT, notes TEXT, archived INTEGER DEFAULT 0, created_at INTEGER)").run(); } catch (e) {}
  try { await env.phobiafree_db.prepare("CREATE TABLE IF NOT EXISTS payment_links (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, client_name TEXT, client_email TEXT, amount_cents INTEGER, description TEXT, paid INTEGER DEFAULT 0, stripe_session_id TEXT, created_at INTEGER)").run(); } catch (e) {}
  adminColsReady = true;
}
async function getSetting(env, key) {
  try { const r = await env.phobiafree_db.prepare('SELECT v FROM app_settings WHERE k = ?').bind(key).first(); return r ? r.v : null; } catch (e) { return null; }
}
async function setSetting(env, key, val) {
  await env.phobiafree_db.prepare('INSERT INTO app_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(key, val).run();
}
async function adminToken(env) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((env.ADMIN_PASSWORD || '') + '|pf-admin-v1'));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function adminAuthed(env, data) {
  if (!env.ADMIN_PASSWORD) return false;
  const tok = (data && data.token) || '';
  return !!tok && tok === (await adminToken(env));
}
async function handleAdmin(path, request, env) {
  await ensureAdminCols(env);
  const data = await request.json().catch(() => ({}));
  if (path === '/admin/login') {
    const stored = await getSetting(env, 'admin_password');
    const pw = (data.password || '');
    const okPw = (env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD) || (stored && pw === stored);
    if (okPw) return json({ ok: true, token: await adminToken(env) });
    return json({ ok: false, error: 'Invalid password' }, 401);
  }
  if (!(await adminAuthed(env, data))) return json({ ok: false, error: 'unauthorized' }, 401);
  if (path === '/admin/consultations') {
    let rows = [];
    try { const res = await env.phobiafree_db.prepare('SELECT * FROM consultations ORDER BY id DESC LIMIT 500').all(); rows = res.results || []; }
    catch (e) { return json({ ok: true, columns: [], rows: [], note: 'no consultations table yet' }); }
    return json({ ok: true, columns: rows.length ? Object.keys(rows[0]) : [], rows });
  }
  if (path === '/admin/consultation/status') {
    const id = parseInt(data.id, 10) || 0;
    const status = (data.status || '').toString().slice(0, 40);
    try { await env.phobiafree_db.prepare('UPDATE consultations SET status = ? WHERE id = ?').bind(status, id).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/consultation/delete') {
    const id = parseInt(data.id, 10) || 0;
    if (!id) return json({ ok: false, error: 'Missing id' });
    try {
      // Detach/remove dependents first — payment_links has FK to consultations.
      await env.phobiafree_db
        .prepare('UPDATE payment_links SET consultation_id = NULL WHERE consultation_id = ? AND IFNULL(paid, 0) = 1')
        .bind(id).run();
      await env.phobiafree_db
        .prepare('DELETE FROM payment_links WHERE consultation_id = ?')
        .bind(id).run();
      await env.phobiafree_db
        .prepare('DELETE FROM therapy_sessions WHERE consultation_id = ?')
        .bind(id).run();
      try {
        await env.phobiafree_db
          .prepare('DELETE FROM clients WHERE consultation_id = ?')
          .bind(id).run();
      } catch (e) {}
      await env.phobiafree_db.prepare('DELETE FROM consultations WHERE id = ?').bind(id).run();
    }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/visitors') {
    let rows = [];
    try { const res = await env.phobiafree_db.prepare('SELECT * FROM visitor_log ORDER BY last_seen DESC LIMIT 500').all(); rows = res.results || []; }
    catch (e) { return json({ ok: true, columns: [], rows: [], note: 'no visitor_log table yet' }); }
    return json({ ok: true, columns: rows.length ? Object.keys(rows[0]) : [], rows });
  }
  if (path === '/admin/visitor/delete') {
    const vid = (data.vid || '').toString().slice(0, 80);
    try { await env.phobiafree_db.prepare('DELETE FROM visitor_log WHERE vid = ?').bind(vid).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/visitors/clear') {
    try { await env.phobiafree_db.prepare('DELETE FROM visitor_log').run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/change-password') {
    const stored = await getSetting(env, 'admin_password');
    const cur = (data.current || '');
    const valid = (env.ADMIN_PASSWORD && cur === env.ADMIN_PASSWORD) || (stored && cur === stored);
    if (!valid) return json({ ok: false, error: 'Current password is incorrect' });
    const np = (data.new || '').toString();
    if (np.length < 8) return json({ ok: false, error: 'New password must be at least 8 characters' });
    await setSetting(env, 'admin_password', np);
    return json({ ok: true });
  }
  if (path === '/admin/stats') {
    const stats = { consultations: 0, byStatus: {}, visits: 0, chats: 0 };
    try { const r = await env.phobiafree_db.prepare('SELECT COUNT(*) AS c FROM consultations').first(); stats.consultations = r ? r.c : 0; } catch (e) {}
    try { const r = await env.phobiafree_db.prepare('SELECT status, COUNT(*) AS c FROM consultations GROUP BY status').all(); (r.results || []).forEach(function(row){ stats.byStatus[row.status || 'unset'] = row.c; }); } catch (e) {}
    try { const r = await env.phobiafree_db.prepare('SELECT COUNT(*) AS c FROM visitor_log').first(); stats.visits = r ? r.c : 0; } catch (e) {}
    try { const r = await env.phobiafree_db.prepare('SELECT COUNT(DISTINCT vid) AS c FROM chat_messages').first(); stats.chats = r ? r.c : 0; } catch (e) {}
    return json({ ok: true, stats });
  }
  if (path === '/admin/clients') {
    const showArch = !!data.showArchived;
    let rows = [];
    try {
      const q = showArch ? 'SELECT * FROM clients ORDER BY created_at DESC LIMIT 1000' : 'SELECT * FROM clients WHERE archived = 0 ORDER BY created_at DESC LIMIT 1000';
      const res = await env.phobiafree_db.prepare(q).all(); rows = res.results || [];
    } catch (e) { return json({ ok: true, columns: [], rows: [] }); }
    return json({ ok: true, columns: rows.length ? Object.keys(rows[0]) : [], rows });
  }
  if (path === '/admin/client/add') {
    const f = function (k) { return (data[k] || '').toString().slice(0, 300); };
    if (!f('first_name') && !f('last_name') && !f('email')) return json({ ok: false, error: 'Enter at least a name or email' });
    try { await env.phobiafree_db.prepare('INSERT INTO clients (first_name, last_name, email, phone, phobia, notes, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').bind(f('first_name'), f('last_name'), f('email'), f('phone'), f('phobia'), f('notes'), Math.floor(Date.now() / 1000)).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/client/archive' || path === '/admin/client/unarchive') {
    const id = parseInt(data.id, 10) || 0;
    const val = path.endsWith('unarchive') ? 0 : 1;
    try { await env.phobiafree_db.prepare('UPDATE clients SET archived = ? WHERE id = ?').bind(val, id).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/client/delete') {
    const id = parseInt(data.id, 10) || 0;
    try { await env.phobiafree_db.prepare('DELETE FROM clients WHERE id = ?').bind(id).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/payment/config') {
    const dp = await getSetting(env, 'default_price_cents');
    return json({ ok: true, default_price_cents: dp ? parseInt(dp, 10) : 29900 });
  }
  if (path === '/admin/payment/set-default') {
    const cents = parseInt(data.cents, 10) || 0;
    if (cents < 1) return json({ ok: false, error: 'Enter a valid amount' });
    await setSetting(env, 'default_price_cents', String(cents));
    return json({ ok: true });
  }
  if (path === '/admin/payment/create') {
    const name = (data.name || '').toString().slice(0, 200);
    const email = (data.email || '').toString().slice(0, 200);
    const desc = ((data.description || '').toString().slice(0, 200)) || 'PhobiaFree Session';
    let cents = parseInt(data.amount_cents, 10) || 0;
    if (cents < 1) { const dp = await getSetting(env, 'default_price_cents'); cents = dp ? parseInt(dp, 10) : 29900; }
    const token = [...crypto.getRandomValues(new Uint8Array(20))].map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try { await env.phobiafree_db.prepare('INSERT INTO payment_links (token, client_name, client_email, amount_cents, description, paid, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(token, name, email, cents, desc, Math.floor(Date.now() / 1000)).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    const origin = new URL(request.url).origin;
    return json({ ok: true, token: token, url: origin + '/pay/checkout?token=' + token });
  }
  if (path === '/admin/payments') {
    let rows = [];
    try { const res = await env.phobiafree_db.prepare('SELECT id, token, client_name, client_email, amount_cents, description, paid, created_at FROM payment_links ORDER BY created_at DESC LIMIT 500').all(); rows = res.results || []; }
    catch (e) { return json({ ok: true, rows: [] }); }
    const origin = new URL(request.url).origin;
    rows.forEach(function (r) { r.url = origin + '/pay/checkout?token=' + r.token; });
    return json({ ok: true, rows: rows });
  }
  if (path === '/admin/payment/delete') {
    const id = parseInt(data.id, 10) || 0;
    try { await env.phobiafree_db.prepare('DELETE FROM payment_links WHERE id = ?').bind(id).run(); } catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  if (path === '/admin/payment/refresh') {
    let rows = [];
    try { const res = await env.phobiafree_db.prepare('SELECT token, stripe_session_id FROM payment_links WHERE paid = 0 AND stripe_session_id IS NOT NULL LIMIT 100').all(); rows = res.results || []; } catch (e) {}
    let updated = 0;
    for (const r of rows) {
      try { const sess = await stripeGet(env, 'checkout/sessions/' + r.stripe_session_id); if (sess && sess.payment_status === 'paid') { await env.phobiafree_db.prepare('UPDATE payment_links SET paid = 1 WHERE token = ?').bind(r.token).run(); updated++; } } catch (e) {}
    }
    return json({ ok: true, updated: updated });
  }
  return json({ ok: false, error: 'unknown admin route' }, 404);
}

// ── PAYMENTS (Stripe hosted checkout) ────────────────────────────────────────
async function stripe(env, ep, params) {
  const r = await fetch('https://api.stripe.com/v1/' + ep, { method: 'POST', headers: { 'Authorization': 'Bearer ' + (env.STRIPE_SECRET_KEY || ''), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  return r.json();
}
async function stripeGet(env, ep) {
  const r = await fetch('https://api.stripe.com/v1/' + ep, { headers: { 'Authorization': 'Bearer ' + (env.STRIPE_SECRET_KEY || '') } });
  return r.json();
}
function payPage(title, msg, icon) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:16vh auto;text-align:center;padding:2rem;"><div style="font-size:3rem">' + icon + '</div><h1 style="font-family:Georgia,serif;color:#124d52;font-size:1.45rem;margin:1rem 0 .6rem">' + title + '</h1><p style="color:#555;line-height:1.6;font-size:1rem">' + msg + '</p></div>', { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
async function handlePay(path, url, env) {
  await ensureAdminCols(env);
  const token = (url.searchParams.get('token') || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return payPage('Invalid link', 'This payment link is missing its code.', '⚠️');
  let link;
  try { link = await env.phobiafree_db.prepare('SELECT * FROM payment_links WHERE token = ?').bind(token).first(); } catch (e) {}
  if (!link) return payPage('Link not found', 'This payment link is no longer valid.', '⚠️');

  if (path === '/pay/done') {
    if (url.searchParams.get('cancel')) return payPage('Payment canceled', 'No charge was made. You can reopen your link to try again.', '↩️');
    const sid = url.searchParams.get('session') || link.stripe_session_id;
    if (sid) {
      try {
        const sess = await stripeGet(env, 'checkout/sessions/' + sid);
        if (sess && sess.payment_status === 'paid') {
          await env.phobiafree_db.prepare('UPDATE payment_links SET paid = 1 WHERE token = ?').bind(token).run();
          return payPage('Payment received', 'Thank you! Your payment was successful. Stripe has emailed your receipt.', '✅');
        }
      } catch (e) {}
    }
    if (link.paid) return payPage('Payment received', 'Thank you — this payment is already complete.', '✅');
    return payPage('Payment pending', 'We have not confirmed your payment yet. If you just paid, give it a moment and refresh.', '⏳');
  }

  // /pay/checkout
  if (link.paid) return payPage('Already paid', 'This link has already been paid. Thank you!', '✅');
  if (!env.STRIPE_SECRET_KEY) return payPage('Not configured', 'Payments are not set up yet.', '⚠️');
  const base = url.origin;
  const params = {
    'mode': 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(link.amount_cents || 0),
    'line_items[0][price_data][product_data][name]': link.description || 'PhobiaFree Session',
    'success_url': base + '/pay/done?token=' + token + '&session={CHECKOUT_SESSION_ID}',
    'cancel_url': base + '/pay/done?token=' + token + '&cancel=1',
  };
  if (link.client_email) params['customer_email'] = link.client_email;
  let sess;
  try { sess = await stripe(env, 'checkout/sessions', params); } catch (e) { return payPage('Error', 'Could not start checkout. Please try again.', '⚠️'); }
  if (!sess || !sess.url) return payPage('Error', 'Could not start checkout: ' + ((sess && sess.error && sess.error.message) || 'unknown error') + '.', '⚠️');
  try { await env.phobiafree_db.prepare('UPDATE payment_links SET stripe_session_id = ? WHERE token = ?').bind(sess.id, token).run(); } catch (e) {}
  return Response.redirect(sess.url, 302);
}
