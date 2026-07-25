/** Site settings stored in D1 (hours, price, etc.). */

const DEFAULT_HOURS = [[13, 15], [19, 21]];
const DEFAULT_PRICE_CENTS = 27900;

let schemaReady = false;

export async function ensureSettingsSchema(env) {
  if (schemaReady) return;
  await env.phobiafree_db
    .prepare('CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    .run();
  schemaReady = true;
}

export async function getSetting(env, key, fallback = null) {
  await ensureSettingsSchema(env);
  const row = await env.phobiafree_db
    .prepare('SELECT value FROM site_settings WHERE key = ?')
    .bind(key)
    .first();
  return row?.value ?? fallback;
}

export async function setSetting(env, key, value) {
  await ensureSettingsSchema(env);
  await env.phobiafree_db
    .prepare(
      'INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, String(value))
    .run();
}

/** @returns {Promise<number[][]>} e.g. [[13,15],[19,21]] */
export async function getHoursWindows(env) {
  const raw = await getSetting(env, 'hours_windows', null);
  if (!raw) return DEFAULT_HOURS.map((w) => w.slice());
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_HOURS.map((w) => w.slice());
    return parsed
      .map((w) => [Number(w[0]), Number(w[1])])
      .filter((w) => Number.isFinite(w[0]) && Number.isFinite(w[1]) && w[1] > w[0] && w[0] >= 0 && w[1] <= 24);
  } catch {
    return DEFAULT_HOURS.map((w) => w.slice());
  }
}

export async function setHoursWindows(env, windows) {
  const clean = (windows || [])
    .map((w) => [Number(w[0]), Number(w[1])])
    .filter((w) => Number.isFinite(w[0]) && Number.isFinite(w[1]) && w[1] > w[0] && w[0] >= 0 && w[1] <= 24);
  if (!clean.length) throw new Error('At least one valid hours window is required');
  await setSetting(env, 'hours_windows', JSON.stringify(clean));
  return clean;
}

export async function getSessionPriceCents(env) {
  const fromDb = await getSetting(env, 'session_price_cents', null);
  if (fromDb != null && fromDb !== '') {
    const n = parseInt(fromDb, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromEnv = parseInt(env.SESSION_PRICE_CENTS || String(DEFAULT_PRICE_CENTS), 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PRICE_CENTS;
}

export async function setSessionPriceCents(env, cents) {
  const n = parseInt(cents, 10);
  if (!Number.isFinite(n) || n < 100) throw new Error('Price must be at least $1.00');
  await setSetting(env, 'session_price_cents', String(n));
  return n;
}

export function formatHoursLabel(windows) {
  return (windows || [])
    .map(([a, b]) => {
      const fmt = (h) => {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hr = h % 12 === 0 ? 12 : h % 12;
        return `${hr}:00 ${ampm}`;
      };
      return `${fmt(a)} – ${fmt(b)}`;
    })
    .join(', ');
}
