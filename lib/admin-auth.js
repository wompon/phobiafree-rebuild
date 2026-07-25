/** Shared admin session cookie auth for admin-api + crm-api workers. */
export const COOKIE_NAME = 'pf_admin_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export const ALLOWED_ORIGINS = [
  'https://phobiafree.pages.dev',
  'https://www.phobiafree.life',
  'https://phobiafree.life',
];

let _reqOrigin = null;

export function setRequestOrigin(origin) {
  _reqOrigin = origin;
}

export function corsHeaders(extra = {}) {
  let allowOrigin = 'https://phobiafree.life';
  if (_reqOrigin) {
    try {
      const host = new URL(_reqOrigin).hostname;
      if (
        ALLOWED_ORIGINS.includes(_reqOrigin) ||
        /\.phobiafree\.pages\.dev$/.test(host) ||
        /\.workers\.dev$/.test(host)
      ) {
        allowOrigin = _reqOrigin;
      }
    } catch (e) {}
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(extraHeaders) });
}

export async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function makeSessionToken(env) {
  const expires = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `admin:${expires}`;
  const sig = await hmacSign(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(env, token) {
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = await hmacSign(env.SESSION_SECRET, payload);
  if (sig !== expected) return false;
  const expires = parseInt(payload.split(':')[1], 10);
  return Date.now() < expires;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAuth(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  return verifySessionToken(env, token);
}

export async function checkPassword(env, username, password) {
  const row = await env.phobiafree_db
    .prepare("SELECT setting_value FROM settings WHERE setting_key = 'admin_password'")
    .first();
  const stored = row?.setting_value;
  if (!stored || stored === 'CHANGE_ME') return false;
  const adminUser = env.ADMIN_USERNAME || 'launch';
  if (username !== adminUser) return false;
  const hash = await sha256Hex(password);
  if (stored === password) return true;
  if (stored === hash) return true;
  if (/^[a-f0-9]{64}$/i.test(stored) && hash === stored) return true;
  return false;
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}; Path=/`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Max-Age=0; Path=/`;
}

export async function setAdminPassword(env, password) {
  const hash = await sha256Hex(password);
  await env.phobiafree_db
    .prepare(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('admin_password', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
    )
    .bind(hash)
    .run();
}

export async function createResetToken(env) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256Hex(token);
  const exp = String(Date.now() + 60 * 60 * 1000);
  await env.phobiafree_db
    .prepare(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('admin_reset_token', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
    )
    .bind(JSON.stringify({ hash, exp: Number(exp) }))
    .run();
  return token;
}

export async function consumeResetToken(env, token) {
  const row = await env.phobiafree_db
    .prepare("SELECT setting_value FROM settings WHERE setting_key = 'admin_reset_token'")
    .first();
  if (!row?.setting_value || !token) return false;
  let payload;
  try {
    payload = JSON.parse(row.setting_value);
  } catch {
    return false;
  }
  if (!payload.exp || payload.exp < Date.now()) return false;
  const hash = await sha256Hex(token);
  if (hash !== payload.hash) return false;
  await env.phobiafree_db.prepare("DELETE FROM settings WHERE setting_key = 'admin_reset_token'").run();
  return true;
}

export async function sendResetLink(env, resetUrl) {
  const phone = (env.ADMIN_PHONE || env.NOTIFY_PHONE || env.STEVEN_PHONE || '').trim();
  const sid = env.TWILIO_SID?.trim();
  const token = env.TWILIO_TOKEN?.trim();
  const from = env.TWILIO_FROM?.trim();
  if (phone && sid && token && from) {
    const to = phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, '');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: `phobiafree.life admin reset (1 hour): ${resetUrl}`,
      }),
    });
    if (res.ok) return { ok: true, channel: 'sms' };
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `SMS failed (${res.status})${detail ? ': ' + detail.slice(0, 120) : ''}` };
  }
  return { ok: false, error: 'SMS not configured' };
}
