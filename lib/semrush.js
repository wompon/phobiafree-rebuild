/**
 * Semrush API (v3 SEO) — domain overview / organic / paid / competitors → D1.
 * Secrets: SEMRUSH_API_KEY (wrangler secret) and/or ark_prefs.semrush_api_key
 * Prefs (D1 ark_prefs): domain, database, sync sets, daily flag, last sync/error, overview, competitors
 *
 * API units (approx): overview ~10, organic 10/line, paid 20/line, organic competitors 40/line.
 * Keep display_limit modest. CSV upload remains the offline fallback.
 */

const SEMRUSH_API = 'https://api.semrush.com/';
const DEFAULT_DOMAIN = 'phobiafree.life';
const DEFAULT_DATABASE = 'us';
const DEFAULT_SYNC_SETS = ['overview', 'organic', 'paid', 'competitors'];
const INTENT_LABELS = {
  0: 'informational',
  1: 'navigational',
  2: 'commercial',
  3: 'transactional',
};

export function normalizeSemrushDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return s.slice(0, 200);
}

export function normalizeApiKey(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^api[_ ]?key\s*[:=]\s*/i, '');
  s = s.replace(/^["']|["']$/g, '');
  s = s.replace(/\s+/g, '');
  if (/^[•·.…]{3,}$/.test(s) || s.includes('•')) s = '';
  return s.slice(0, 200);
}

export async function loadSemrushPrefs(env) {
  const keys = [
    'semrush_api_key',
    'semrush_domain',
    'semrush_database',
    'semrush_sync_sets',
    'semrush_daily_sync',
    'semrush_display_limit',
    'semrush_last_sync',
    'semrush_last_error',
    'semrush_last_attempt',
    'semrush_overview',
    'semrush_competitors',
    'semrush_last_result',
  ];
  const out = {};
  for (const key of keys) {
    const row = await env.phobiafree_db.prepare('SELECT value FROM ark_prefs WHERE key = ?').bind(key).first();
    if (row?.value != null) {
      out[key.replace(/^semrush_/, '')] = row.value;
    }
  }
  return out;
}

export async function saveSemrushPref(env, key, value) {
  await env.phobiafree_db.prepare(`
    INSERT INTO ark_prefs (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(`semrush_${key}`, String(value ?? '')).run();
}

export function parseSyncSets(raw) {
  if (Array.isArray(raw)) {
    return raw.map(String).filter((k) => DEFAULT_SYNC_SETS.includes(k));
  }
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      const clean = parsed.map(String).filter((k) => DEFAULT_SYNC_SETS.includes(k));
      return clean.length ? clean : DEFAULT_SYNC_SETS.slice();
    }
  } catch (_) { /* fall through */ }
  return DEFAULT_SYNC_SETS.slice();
}

export function semrushConfigStatus(env, prefs = {}) {
  const apiKey = normalizeApiKey(env.SEMRUSH_API_KEY || prefs.api_key || '');
  const domain = normalizeSemrushDomain(prefs.domain || DEFAULT_DOMAIN) || DEFAULT_DOMAIN;
  const database = String(prefs.database || DEFAULT_DATABASE).trim().toLowerCase() || DEFAULT_DATABASE;
  const syncSets = parseSyncSets(prefs.sync_sets);
  const dailySync = String(prefs.daily_sync || '0') === '1';
  const displayLimit = Math.min(2000, Math.max(10, Number(prefs.display_limit) || 200));
  let overview = null;
  let competitors = [];
  let lastResult = null;
  try { overview = prefs.overview ? JSON.parse(prefs.overview) : null; } catch (_) { overview = null; }
  try { competitors = prefs.competitors ? JSON.parse(prefs.competitors) : []; } catch (_) { competitors = []; }
  try { lastResult = prefs.last_result ? JSON.parse(prefs.last_result) : null; } catch (_) { lastResult = null; }

  return {
    hasApiKey: !!apiKey,
    apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : '',
    fromWorkerSecret: !!(env.SEMRUSH_API_KEY && String(env.SEMRUSH_API_KEY).trim()),
    domain,
    database,
    syncSets,
    dailySync,
    displayLimit,
    ready: !!(apiKey && domain),
    lastSync: prefs.last_sync || null,
    lastError: prefs.last_error || null,
    lastAttempt: prefs.last_attempt || null,
    overview,
    competitors: Array.isArray(competitors) ? competitors : [],
    lastResult,
    missing: [
      !apiKey && 'API key',
      !domain && 'Domain',
    ].filter(Boolean),
  };
}

/** Parse Semrush semicolon CSV (or comma) into row objects. */
export function parseSemrushCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  if (/^ERROR\b/i.test(raw)) {
    throw new Error(raw.split(/\r?\n/)[0].slice(0, 400));
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = splitLine(lines[0], delim).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delim);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] != null ? cols[idx] : ''; });
    rows.push(row);
  }
  return rows;
}

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapIntent(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (INTENT_LABELS[s] != null) return INTENT_LABELS[s];
  // Semrush sometimes returns multi-intent like "0,2"
  if (s.includes(',')) {
    return s.split(',').map((p) => INTENT_LABELS[p.trim()] || p.trim()).filter(Boolean).join(', ');
  }
  const n = Number(s);
  if (Number.isFinite(n) && INTENT_LABELS[n] != null) return INTENT_LABELS[n];
  return s;
}

function pick(row, ...names) {
  for (const n of names) {
    const key = Object.keys(row).find(
      (k) => k.toLowerCase().replace(/[\s_]/g, '') === n.toLowerCase().replace(/[\s_]/g, ''),
    );
    if (key && row[key] !== '') return row[key];
  }
  return '';
}

/** Map API organic/paid row → shape compatible with mapSemrushRow / UI. */
export function mapApiKeywordRow(row, source) {
  const keyword = String(pick(row, 'Keyword', 'Ph', 'Phrase') || '').trim();
  const volume = parseNum(pick(row, 'Search Volume', 'Nq', 'Volume'));
  const kd = parseNum(pick(row, 'Keyword Difficulty', 'Kd', 'KD'));
  const cpc = parseNum(pick(row, 'CPC', 'Cp'));
  const competition = parseNum(pick(row, 'Competition', 'Co', 'Competitive Density'));
  const intent = mapIntent(pick(row, 'Intent', 'In', 'Search Intent'));
  const url = String(pick(row, 'Url', 'URL', 'Ur', 'Page') || '').trim();
  const position = parseNum(pick(row, 'Position', 'Po'));
  return {
    keyword,
    volume,
    kd,
    cpc,
    competition,
    intent,
    url,
    data: {
      Keyword: keyword,
      Volume: volume,
      'Keyword Difficulty': kd,
      CPC: cpc,
      Competition: competition,
      Intent: intent,
      URL: url,
      Position: position,
      Source: source,
      ...row,
    },
  };
}

export function mapOverviewRow(row) {
  return {
    database: String(pick(row, 'Database', 'Db') || ''),
    domain: String(pick(row, 'Domain', 'Dn') || ''),
    rank: parseNum(pick(row, 'Rank', 'Rk')),
    organicKeywords: parseNum(pick(row, 'Organic Keywords', 'Or')),
    organicTraffic: parseNum(pick(row, 'Organic Traffic', 'Ot')),
    organicCost: parseNum(pick(row, 'Organic Cost', 'Oc')),
    adwordsKeywords: parseNum(pick(row, 'Adwords Keywords', 'Ad')),
    adwordsTraffic: parseNum(pick(row, 'Adwords Traffic', 'At')),
    adwordsCost: parseNum(pick(row, 'Adwords Cost', 'Ac')),
    raw: row,
  };
}

export function mapCompetitorRow(row, source) {
  return {
    domain: String(pick(row, 'Domain', 'Dn') || '').trim(),
    relevance: parseNum(pick(row, 'Competitor Relevance', 'Cr')),
    commonKeywords: parseNum(pick(row, 'Common Keywords', 'Np')),
    organicKeywords: parseNum(pick(row, 'Organic Keywords', 'Or')),
    organicTraffic: parseNum(pick(row, 'Organic Traffic', 'Ot')),
    organicCost: parseNum(pick(row, 'Organic Cost', 'Oc')),
    adwordsKeywords: parseNum(pick(row, 'Adwords Keywords', 'Ad')),
    adwordsTraffic: parseNum(pick(row, 'Adwords Traffic', 'At')),
    adwordsCost: parseNum(pick(row, 'Adwords Cost', 'Ac')),
    source,
    raw: row,
  };
}

async function fetchSemrushReport(apiKey, params) {
  const u = new URL(SEMRUSH_API);
  u.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    method: 'GET',
    headers: { Accept: 'text/csv,text/plain,*/*' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Semrush HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return parseSemrushCsv(text);
}

async function insertKeywordRows(env, importId, mappedRows, marks) {
  let inserted = 0;
  for (const mapped of mappedRows) {
    if (!mapped.keyword) continue;
    const mark = marks.get(mapped.keyword.toLowerCase()) || { keep: 0, negative: 0 };
    await env.phobiafree_db.prepare(`
      INSERT INTO semrush_keywords
        (import_id, keyword, volume, kd, cpc, competition, intent, url, keep, negative, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      importId,
      mapped.keyword,
      mapped.volume,
      mapped.kd,
      mapped.cpc,
      mapped.competition,
      mapped.intent,
      mapped.url,
      mark.keep ? 1 : 0,
      mark.negative ? 1 : 0,
      JSON.stringify(mapped.data || mapped),
    ).run();
    inserted += 1;
  }
  return inserted;
}

async function loadKeywordMarks(env) {
  const { results } = await env.phobiafree_db
    .prepare('SELECT keyword, keep, negative FROM semrush_keywords WHERE keep = 1 OR negative = 1')
    .all();
  const marks = new Map();
  for (const r of results || []) {
    const key = String(r.keyword || '').toLowerCase();
    if (!key) continue;
    const prev = marks.get(key) || { keep: 0, negative: 0 };
    marks.set(key, {
      keep: prev.keep || (Number(r.keep) === 1 ? 1 : 0),
      negative: prev.negative || (Number(r.negative) === 1 ? 1 : 0),
    });
  }
  return marks;
}

/**
 * Pull selected Semrush datasets and persist into existing semrush_* tables (+ overview/competitors prefs).
 */
export async function syncSemrushReports(env, prefs, { sets, replaceKeywords = true } = {}) {
  const status = semrushConfigStatus(env, prefs);
  if (!status.ready) {
    throw new Error('Not connected. Save a Semrush API key and domain first.');
  }
  const apiKey = normalizeApiKey(env.SEMRUSH_API_KEY || prefs.api_key || '');
  const domain = status.domain;
  const database = status.database;
  const limit = status.displayLimit;
  const selected = (sets && sets.length ? sets : status.syncSets).filter((k) => DEFAULT_SYNC_SETS.includes(k));
  if (!selected.length) throw new Error('Choose at least one dataset to sync');

  await saveSemrushPref(env, 'last_attempt', new Date().toISOString());

  const marks = replaceKeywords ? await loadKeywordMarks(env) : new Map();
  const summary = [];
  const errors = [];

  if (replaceKeywords && (selected.includes('organic') || selected.includes('paid'))) {
    await env.phobiafree_db.prepare('DELETE FROM semrush_keywords').run();
    await env.phobiafree_db.prepare('DELETE FROM semrush_imports').run();
  }

  if (selected.includes('overview')) {
    try {
      const rows = await fetchSemrushReport(apiKey, {
        type: 'domain_ranks',
        domain,
        database,
        export_columns: 'Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv',
      });
      const overview = rows[0] ? mapOverviewRow(rows[0]) : null;
      await saveSemrushPref(env, 'overview', JSON.stringify(overview));
      summary.push({ type: 'overview', rows: overview ? 1 : 0 });
    } catch (e) {
      errors.push(`overview: ${e.message || e}`);
      summary.push({ type: 'overview', rows: 0, error: String(e.message || e).slice(0, 200) });
    }
  }

  if (selected.includes('organic')) {
    try {
      const rows = await fetchSemrushReport(apiKey, {
        type: 'domain_organic',
        domain,
        database,
        display_limit: String(limit),
        display_sort: 'nq_desc',
        export_columns: 'Ph,Po,Nq,Cp,Co,Kd,In,Ur,Tr',
      });
      const mapped = rows.map((r) => mapApiKeywordRow(r, 'organic')).filter((r) => r.keyword);
      const ins = await env.phobiafree_db.prepare(`
        INSERT INTO semrush_imports (filename, row_count, created_at)
        VALUES (?, ?, datetime('now'))
      `).bind(`api:domain_organic:${domain}`, mapped.length).run();
      const importId = ins.meta?.last_row_id;
      const inserted = await insertKeywordRows(env, importId, mapped, marks);
      summary.push({ type: 'organic', rows: inserted });
    } catch (e) {
      errors.push(`organic: ${e.message || e}`);
      summary.push({ type: 'organic', rows: 0, error: String(e.message || e).slice(0, 200) });
    }
  }

  if (selected.includes('paid')) {
    try {
      const rows = await fetchSemrushReport(apiKey, {
        type: 'domain_adwords',
        domain,
        database,
        display_limit: String(Math.min(limit, 500)),
        display_sort: 'nq_desc',
        export_columns: 'Ph,Po,Nq,Cp,Co,Ur,Tr',
      });
      const mapped = rows.map((r) => mapApiKeywordRow(r, 'paid')).filter((r) => r.keyword);
      const ins = await env.phobiafree_db.prepare(`
        INSERT INTO semrush_imports (filename, row_count, created_at)
        VALUES (?, ?, datetime('now'))
      `).bind(`api:domain_adwords:${domain}`, mapped.length).run();
      const importId = ins.meta?.last_row_id;
      const inserted = await insertKeywordRows(env, importId, mapped, marks);
      summary.push({ type: 'paid', rows: inserted });
    } catch (e) {
      // Paid data often empty / plan-gated — soft-fail so organic still usable
      errors.push(`paid: ${e.message || e}`);
      summary.push({ type: 'paid', rows: 0, error: String(e.message || e).slice(0, 200) });
    }
  }

  if (selected.includes('competitors')) {
    try {
      const rows = await fetchSemrushReport(apiKey, {
        type: 'domain_organic_organic',
        domain,
        database,
        display_limit: '25',
        export_columns: 'Dn,Cr,Np,Or,Ot,Oc,Ad',
      });
      const competitors = rows.map((r) => mapCompetitorRow(r, 'organic')).filter((r) => r.domain);
      await saveSemrushPref(env, 'competitors', JSON.stringify(competitors));
      summary.push({ type: 'competitors', rows: competitors.length });
    } catch (e) {
      errors.push(`competitors: ${e.message || e}`);
      summary.push({ type: 'competitors', rows: 0, error: String(e.message || e).slice(0, 200) });
    }
  }

  const when = new Date().toISOString();
  const okCount = summary.filter((s) => s.rows > 0 && !s.error).length;
  const result = { ok: okCount > 0 || errors.length === 0, synced_at: when, domain, database, reports: summary, errors };
  await saveSemrushPref(env, 'last_result', JSON.stringify(result));
  if (okCount > 0 || errors.length === 0) {
    await saveSemrushPref(env, 'last_sync', when);
  }
  await saveSemrushPref(env, 'last_error', errors.length ? errors.join(' · ').slice(0, 800) : '');

  if (okCount === 0 && errors.length) {
    throw new Error(errors.join(' · '));
  }
  return result;
}

/**
 * Cron hook: if daily sync enabled and last sync older than ~24h, pull once.
 * Safe to call every minute — uses last_attempt guard.
 */
export async function maybeScheduledSemrushSync(env) {
  try {
    // Ensure prefs table exists (ark schema may not have run yet)
    await env.phobiafree_db.prepare(`
      CREATE TABLE IF NOT EXISTS ark_prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    await env.phobiafree_db.prepare(`
      CREATE TABLE IF NOT EXISTS semrush_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        row_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    await env.phobiafree_db.prepare(`
      CREATE TABLE IF NOT EXISTS semrush_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER,
        keyword TEXT NOT NULL,
        volume INTEGER,
        kd REAL,
        cpc REAL,
        competition REAL,
        intent TEXT,
        url TEXT,
        keep INTEGER DEFAULT 0,
        negative INTEGER DEFAULT 0,
        data_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const prefs = await loadSemrushPrefs(env);
    if (String(prefs.daily_sync || '0') !== '1') return { skipped: true, reason: 'daily_off' };
    const status = semrushConfigStatus(env, prefs);
    if (!status.ready) return { skipped: true, reason: 'not_ready' };

    const now = Date.now();
    const lastAttempt = prefs.last_attempt ? Date.parse(prefs.last_attempt) : 0;
    if (lastAttempt && now - lastAttempt < 30 * 60 * 1000) {
      return { skipped: true, reason: 'recent_attempt' };
    }
    const lastSync = prefs.last_sync ? Date.parse(prefs.last_sync) : 0;
    if (lastSync && now - lastSync < 23 * 60 * 60 * 1000) {
      return { skipped: true, reason: 'fresh' };
    }

    const result = await syncSemrushReports(env, prefs, { replaceKeywords: true });
    return { skipped: false, result };
  } catch (e) {
    try {
      await saveSemrushPref(env, 'last_error', String(e.message || e).slice(0, 500));
      await saveSemrushPref(env, 'last_attempt', new Date().toISOString());
    } catch (_) { /* ignore */ }
    return { skipped: false, error: String(e.message || e) };
  }
}
