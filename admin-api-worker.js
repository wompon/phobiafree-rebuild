/**
 * Admin API — login, session list, replay, delete.
 */
import {
  setRequestOrigin, json, requireAuth, checkPassword,
  makeSessionToken, sessionCookie, clearSessionCookie,
  setAdminPassword, createResetToken, consumeResetToken, sendResetLink,
} from './lib/admin-auth.js';

function cleanVid(raw) {
  return (raw || '').replace(/[^a-z0-9_]/gi, '');
}

export default {
  async fetch(request, env) {
    setRequestOrigin(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: json({}).headers });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return await handleLogin(request, env);
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return handleLogout();
      }
      if (url.pathname === '/api/sessions' && request.method === 'GET') {
        return await handleGetSessions(request, env);
      }
      if (url.pathname === '/api/replay' && request.method === 'GET') {
        return await handleGetReplay(request, env, url);
      }
      if (url.pathname === '/api/delete' && request.method === 'POST') {
        return await handleDelete(request, env);
      }
      if (url.pathname === '/api/forgot-password' && request.method === 'POST') {
        return await handleForgotPassword(request, env);
      }
      if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        return await handleResetPassword(request, env);
      }
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        return await handleChangePassword(request, env);
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  },
};

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return json({ ok: false, error: 'missing credentials' }, 400);
  }
  if (!env.SESSION_SECRET) {
    return json({ ok: false, error: 'SESSION_SECRET not configured' }, 503);
  }
  const ok = await checkPassword(env, body.username, body.password);
  if (!ok) return json({ ok: false, error: 'invalid credentials' }, 401);

  const token = await makeSessionToken(env);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

function handleLogout() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function handleForgotPassword(request, env) {
  const url = new URL(request.url);
  const token = await createResetToken(env);
  const page = (await request.json().catch(() => ({})))?.page === 'visitors' ? '/visitors.html' : '/visitor_log.html';
  const resetUrl = `${url.origin}${page}?reset=${encodeURIComponent(token)}`;
  const sent = await sendResetLink(env, resetUrl);
  if (!sent.ok) return json({ ok: false, error: sent.error || 'Could not send reset link' }, 503);
  return json({ ok: true, message: `Reset link sent by ${sent.channel === 'sms' ? 'text' : 'email'}.` });
}

async function handleResetPassword(request, env) {
  const body = await request.json().catch(() => null);
  const token = body?.token || '';
  const password = body?.password || '';
  if (!token || password.length < 8) {
    return json({ ok: false, error: 'Token and password (8+ chars) required' }, 400);
  }
  if (!(await consumeResetToken(env, token))) {
    return json({ ok: false, error: 'Reset link is invalid or expired' }, 400);
  }
  await setAdminPassword(env, password);
  if (!env.SESSION_SECRET) return json({ ok: true });
  const session = await makeSessionToken(env);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session) });
}

async function handleChangePassword(request, env) {
  if (!(await requireAuth(request, env))) return json({ ok: false, error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  const username = env.ADMIN_USERNAME || 'launch';
  if (!(await checkPassword(env, username, body?.currentPassword || ''))) {
    return json({ ok: false, error: 'Current password is incorrect' }, 400);
  }
  if (!body?.newPassword || body.newPassword.length < 8) {
    return json({ ok: false, error: 'New password must be at least 8 characters' }, 400);
  }
  await setAdminPassword(env, body.newPassword);
  const session = await makeSessionToken(env);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session) });
}

async function handleGetSessions(request, env) {
  if (!(await requireAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const { results } = await env.phobiafree_db
    .prepare(`
      SELECT v.vid, v.location, v.device, v.first_seen, v.last_seen, v.total_seconds, v.pages,
             COUNT(s.id) as snap_count
      FROM visitor_log v
      LEFT JOIN session_snapshots s ON s.vid = v.vid
      GROUP BY v.vid
      ORDER BY v.last_seen DESC
      LIMIT 200
    `)
    .all();

  return json(results);
}

async function handleGetReplay(request, env, url) {
  if (!(await requireAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const vid = cleanVid(url.searchParams.get('vid'));
  if (!vid) return json([], 200);

  // Optional: only frames after this created_at (live-tail while visitor still browsing)
  const afterRaw = (url.searchParams.get('after') || '').toString();
  const after = afterRaw.replace(/[^0-9:\- ]/g, '').slice(0, 32);

  let results;
  if (after) {
    ({ results } = await env.phobiafree_db
      .prepare(
        'SELECT snapshot, created_at FROM session_snapshots WHERE vid = ? AND created_at > ? ORDER BY created_at ASC LIMIT 5000'
      )
      .bind(vid, after)
      .all());
  } else {
    ({ results } = await env.phobiafree_db
      .prepare(
        'SELECT snapshot, created_at FROM session_snapshots WHERE vid = ? ORDER BY created_at ASC LIMIT 20000'
      )
      .bind(vid)
      .all());
  }

  const rows = [];
  for (const row of results || []) {
    try {
      const snap = JSON.parse(row.snapshot);
      snap._ts = row.created_at;
      rows.push(snap);
    } catch { /* skip malformed */ }
  }
  return json(rows);
}

async function handleDelete(request, env) {
  if (!(await requireAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => null);
  const vid = cleanVid(body?.vid);
  if (!vid) return json({ ok: false, error: 'missing vid' }, 400);

  await env.phobiafree_db.prepare('DELETE FROM session_snapshots WHERE vid = ?').bind(vid).run();
  await env.phobiafree_db.prepare('DELETE FROM visitor_log WHERE vid = ?').bind(vid).run();

  return json({ ok: true });
}
