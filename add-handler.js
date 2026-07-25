const fs=require('fs');
const p='chat-worker.js';
let s=fs.readFileSync(p,'utf8');
if(s.includes('async function handleAdmin')){ console.log('already present'); }
else {
s=s.trimEnd()+`

let adminColsReady = false;
async function ensureAdminCols(env) {
  if (adminColsReady) return;
  try { await env.phobiafree_db.prepare("ALTER TABLE consultations ADD COLUMN status TEXT DEFAULT 'new'").run(); } catch (e) {}
  adminColsReady = true;
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
    if (env.ADMIN_PASSWORD && (data.password || '') === env.ADMIN_PASSWORD) return json({ ok: true, token: await adminToken(env) });
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
    try { await env.phobiafree_db.prepare('DELETE FROM consultations WHERE id = ?').bind(id).run(); }
    catch (e) { return json({ ok: false, error: String(e) }); }
    return json({ ok: true });
  }
  return json({ ok: false, error: 'unknown admin route' }, 404);
}
