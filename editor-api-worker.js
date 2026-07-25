/**
 * Full PhobiaFree page editor API
 * Auth + photos + copy + body HTML + includes + shared CSS
 */
import {
  checkEditorPasscode,
  requireEditorAuth,
  makeEditorToken,
  editorSessionCookie,
  clearEditorSessionCookie,
  corsHeaders,
  json,
} from './lib/editor-auth.js';
import { setRequestOrigin } from './lib/admin-auth.js';
import {
  COPY_FIELDS,
  loadEditorText,
  loadEditorJson,
  putEditorText,
  bodyFromCopy,
  listEditorPages,
  listIncludes,
  hasEditorOverride,
  normalizePageColors,
} from './lib/bento-compose.js';

export { serveSiteImageOverride, r2ImageKey } from './editor-images.js';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function requireOk(request, env) {
  if (!(await requireEditorAuth(request, env))) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return null;
}

async function handleLogin(request, env) {
  if (!env.SESSION_SECRET) {
    return json({ ok: false, error: 'SESSION_SECRET not configured' }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const passcode = String(body.passcode || body.password || '');
  if (!passcode) return json({ ok: false, error: 'Passcode required' }, 400);
  if (!(await checkEditorPasscode(env, passcode))) {
    return json({ ok: false, error: 'Wrong passcode' }, 401);
  }
  const token = await makeEditorToken(env);
  return json({ ok: true }, 200, { 'Set-Cookie': editorSessionCookie(token) });
}

async function handleLogout() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearEditorSessionCookie() });
}

async function handleMe(request, env) {
  return json({ ok: true, authenticated: await requireEditorAuth(request, env) });
}

async function handleCatalog(request, env) {
  const denied = await requireOk(request, env);
  if (denied) return denied;

  const slugs = await listEditorPages(env);
  const includes = await listIncludes(env);
  const pages = [];
  for (const slug of slugs) {
    const meta = await loadEditorJson(env, `pages/${slug}/page.json`);
    if (!meta) continue;
    const imgKey = `site-img/${slug}/img/${meta.image || 'photo.png'}`;
    const head = env.CHAT_FILES ? await env.CHAT_FILES.head(imgKey) : null;
    pages.push({
      slug,
      label: meta.label || slug,
      image: meta.image,
      path: `/${slug}/img/${meta.image}`,
      hasPhotoOverride: Boolean(head),
      hasCopyOverride: await hasEditorOverride(env, `pages/${slug}/copy.json`),
      hasBodyOverride: await hasEditorOverride(env, `pages/${slug}/body.html`),
    });
  }
  return json({
    ok: true,
    pages,
    includes,
    copyFields: COPY_FIELDS,
    hasCssOverride: await hasEditorOverride(env, 'styles.css'),
  });
}

async function handleGetPage(request, env, slug) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  const meta = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!meta) return json({ ok: false, error: 'Page not found' }, 404);
  const copy = (await loadEditorJson(env, `pages/${slug}/copy.json`)) || {};
  const body = (await loadEditorText(env, `pages/${slug}/body.html`)) || '';
  return json({
    ok: true,
    slug,
    page: meta,
    copy,
    body,
    copyFields: COPY_FIELDS,
  });
}

async function handlePutPage(request, env, slug) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const existing = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!existing) return json({ ok: false, error: 'Page not found' }, 404);

  const page = { ...existing, ...(payload.page || {}) };
  page.slug = slug;
  if (payload.copy?.label) page.label = payload.copy.label;
  if (payload.copy?.title) page.title = payload.copy.title;
  if (payload.copy?.description) page.description = payload.copy.description;

  let copy = (await loadEditorJson(env, `pages/${slug}/copy.json`)) || { slug };
  if (payload.copy && typeof payload.copy === 'object') {
    copy = { ...copy, ...payload.copy, slug };
  }

  let body = await loadEditorText(env, `pages/${slug}/body.html`);
  if (typeof payload.body === 'string') {
    body = payload.body;
  } else if (payload.rebuildBody !== false) {
    const tpl = await loadEditorText(env, 'body.template.html');
    if (tpl) body = bodyFromCopy(tpl, copy);
  }
  if (body == null) return json({ ok: false, error: 'Missing body' }, 500);

  await putEditorText(env, `pages/${slug}/page.json`, JSON.stringify(page, null, 2) + '\n', 'application/json');
  await putEditorText(env, `pages/${slug}/copy.json`, JSON.stringify(copy, null, 2) + '\n', 'application/json');
  await putEditorText(env, `pages/${slug}/body.html`, body, 'text/html; charset=utf-8');

  return json({ ok: true, slug, page, copy, body });
}

async function purgeComposeCache(request, slug) {
  try {
    const origin = new URL(request.url).origin;
    const cache = caches.default;
    await Promise.all([
      cache.delete(new Request(origin + '/' + slug)),
      cache.delete(new Request(origin + '/' + slug + '/')),
      cache.delete(new Request(origin + '/' + slug + '/styles.css')),
      cache.delete(new Request(origin + '/' + slug + '.html')),
    ]);
  } catch (_) {}
}

async function handlePutColors(request, env, slug) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const existing = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!existing) return json({ ok: false, error: 'Page not found' }, 404);

  const colors = normalizePageColors(payload.colors || payload);
  const page = {
    ...existing,
    slug,
    colors,
    colorsVersion: Date.now(),
  };
  await putEditorText(
    env,
    `pages/${slug}/page.json`,
    JSON.stringify(page, null, 2) + '\n',
    'application/json'
  );
  await purgeComposeCache(request, slug);
  return json({ ok: true, slug, page, colors });
}

async function handleGetInclude(request, env, name) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  if (!/^[a-z0-9-]+$/i.test(name)) return json({ ok: false, error: 'Invalid include' }, 400);
  const content = await loadEditorText(env, `includes/${name}.html`);
  if (content == null) return json({ ok: false, error: 'Not found' }, 404);
  return json({
    ok: true,
    name,
    content,
    overridden: await hasEditorOverride(env, `includes/${name}.html`),
  });
}

async function handlePutInclude(request, env, name) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  if (!/^[a-z0-9-]+$/i.test(name)) return json({ ok: false, error: 'Invalid include' }, 400);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const content = String(payload.content ?? '');
  await putEditorText(env, `includes/${name}.html`, content, 'text/html; charset=utf-8');
  return json({ ok: true, name });
}

async function handleGetCss(request, env) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  const content = await loadEditorText(env, 'styles.css');
  if (content == null) return json({ ok: false, error: 'CSS not found' }, 404);
  return json({
    ok: true,
    content,
    overridden: await hasEditorOverride(env, 'styles.css'),
  });
}

async function handlePutCss(request, env) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const content = String(payload.content ?? '');
  await putEditorText(env, 'styles.css', content, 'text/css; charset=utf-8');
  return json({ ok: true });
}

async function handleUpload(request, env) {
  const denied = await requireOk(request, env);
  if (denied) return denied;
  if (!env.CHAT_FILES) return json({ ok: false, error: 'R2 not configured' }, 503);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Expected multipart form' }, 400);
  }

  const slug = String(form.get('slug') || '').trim();
  const meta = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!meta) return json({ ok: false, error: 'Unknown page' }, 400);

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ ok: false, error: 'file required' }, 400);
  }
  const type = (file.type || '').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    return json({ ok: false, error: 'Use JPEG, PNG, WebP, or GIF' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: 'Max file size is 6 MB' }, 400);
  }

  const filename = meta.image || 'photo.png';
  const buf = await file.arrayBuffer();
  const key = `site-img/${slug}/img/${filename}`;
  await env.CHAT_FILES.put(key, buf, { httpMetadata: { contentType: type } });

  // Canonical editor name stays .png, but live pages prefer a sibling .webp.
  // If the upload is already WebP, write that sibling too. Otherwise drop any
  // stale .webp so it can't shadow a fresh PNG/JPEG until optimize is re-run.
  const webpKey = `site-img/${slug}/img/${filename.replace(/\.[^.]+$/, '')}.webp`;
  let hasWebp = false;
  if (webpKey !== key) {
    if (type === 'image/webp') {
      await env.CHAT_FILES.put(webpKey, buf, { httpMetadata: { contentType: 'image/webp' } });
      hasWebp = true;
    } else {
      try { await env.CHAT_FILES.delete(webpKey); } catch (_) {}
    }
  } else {
    hasWebp = type === 'image/webp';
  }

  const photoVersion = Date.now();
  const nextMeta = {
    ...meta,
    hasWebp,
    photoVersion,
  };
  await putEditorText(
    env,
    `pages/${slug}/page.json`,
    JSON.stringify(nextMeta, null, 2) + '\n',
    'application/json'
  );

  return json({
    ok: true,
    slug,
    path: `/${slug}/img/${filename}?v=${photoVersion}`,
    bytes: buf.byteLength,
    photoVersion,
    hasWebp,
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin) setRequestOrigin(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      if (path === '/api/editor/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/api/editor/logout' && request.method === 'POST') return handleLogout();
      if (path === '/api/editor/me' && request.method === 'GET') return handleMe(request, env);
      if (path === '/api/editor/catalog' && request.method === 'GET') return handleCatalog(request, env);
      if (path === '/api/editor/pages' && request.method === 'GET') return handleCatalog(request, env);
      if (path === '/api/editor/css' && request.method === 'GET') return handleGetCss(request, env);
      if (path === '/api/editor/css' && request.method === 'PUT') return handlePutCss(request, env);
      if (path === '/api/editor/upload' && request.method === 'POST') return handleUpload(request, env);

      const colorsMatch = path.match(/^\/api\/editor\/page\/([a-z0-9_-]+)\/colors$/i);
      if (colorsMatch && request.method === 'PUT') {
        return handlePutColors(request, env, colorsMatch[1]);
      }

      const pageMatch = path.match(/^\/api\/editor\/page\/([a-z0-9_-]+)$/i);
      if (pageMatch) {
        if (request.method === 'GET') return handleGetPage(request, env, pageMatch[1]);
        if (request.method === 'PUT') return handlePutPage(request, env, pageMatch[1]);
      }

      const incMatch = path.match(/^\/api\/editor\/include\/([a-z0-9-]+)$/i);
      if (incMatch) {
        if (request.method === 'GET') return handleGetInclude(request, env, incMatch[1]);
        if (request.method === 'PUT') return handlePutInclude(request, env, incMatch[1]);
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500);
    }
  },
};
