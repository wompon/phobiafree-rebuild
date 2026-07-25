/** Passcode session auth for /editor (hero photo uploads). */
import {
  hmacSign,
  sha256Hex,
  getCookie,
  corsHeaders,
  json,
} from './admin-auth.js';

export const EDITOR_COOKIE = 'pf_editor_session';
export const EDITOR_TTL_SECONDS = 60 * 60 * 8;

export { corsHeaders, json, sha256Hex };

export async function makeEditorToken(env) {
  const expires = Date.now() + EDITOR_TTL_SECONDS * 1000;
  const payload = `editor:${expires}`;
  const sig = await hmacSign(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function verifyEditorToken(env, token) {
  if (!token || !env.SESSION_SECRET) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = await hmacSign(env.SESSION_SECRET, payload);
  if (sig !== expected) return false;
  if (!payload.startsWith('editor:')) return false;
  const expires = parseInt(payload.slice('editor:'.length), 10);
  return Date.now() < expires;
}

export async function requireEditorAuth(request, env) {
  const token = getCookie(request, EDITOR_COOKIE);
  return verifyEditorToken(env, token);
}

export function editorSessionCookie(token) {
  return `${EDITOR_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${EDITOR_TTL_SECONDS}; Path=/`;
}

export function clearEditorSessionCookie() {
  return `${EDITOR_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

/** Accepts editor_passcode, falls back to admin_password (same Credentials password). */
export async function checkEditorPasscode(env, passcode) {
  if (!passcode || typeof passcode !== 'string') return false;
  const hash = await sha256Hex(passcode);
  const keys = ['editor_passcode', 'admin_password'];
  for (const key of keys) {
    const row = await env.phobiafree_db
      .prepare('SELECT setting_value FROM settings WHERE setting_key = ?')
      .bind(key)
      .first();
    const stored = row?.setting_value;
    if (!stored || stored === 'CHANGE_ME') continue;
    if (stored === passcode || stored === hash) return true;
  }
  return false;
}

export async function setEditorPasscode(env, passcode) {
  const hash = await sha256Hex(passcode);
  await env.phobiafree_db
    .prepare(
      `INSERT INTO settings (setting_key, setting_value)
       VALUES ('editor_passcode', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
    )
    .bind(hash)
    .run();
}
