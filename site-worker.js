/**
 * Unified PhobiaFree.life site worker.
 * Serves static assets and dispatches API routes to existing worker modules.
 */
import tracker from './visitor-tracker-worker.js';
import chat from './chat-worker.js';
import consult from './consult-api-worker.js';
import admin from './admin-api-worker.js';
import crm from './crm-api-worker.js';
import emailApi from './email-api-worker.js';
import payment from './payment-api-worker.js';
import editor from './editor-api-worker.js';
import { serveSiteImageOverride } from './editor-images.js';
import { composeFearPage, composePageCss, loadEditorText } from './lib/bento-compose.js';
import { pollEvolveAgents } from './lib/ark.js';
import { loadGoogleAdsPrefs, syncGoogleAdsReports, googleAdsConfigStatus } from './lib/google-ads.js';

const ADS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function autoSyncGoogleAds(env) {
  const prefs = await loadGoogleAdsPrefs(env);
  if (!googleAdsConfigStatus(env, prefs).ready) return;
  const last = Date.parse(prefs.last_sync || '') || 0;
  if (Date.now() - last < ADS_SYNC_INTERVAL_MS) return;
  await syncGoogleAdsReports(env, prefs, { replace: true });
}

/** Legacy admin URLs → CRM dashboard HTML (served in-place with no-cache). */
const ADMIN_PAGES = {
  '/admin': '/visitor_log.html',
  '/admin/': '/visitor_log.html',
  '/admin.php': '/visitor_log.html',
  '/visitors_log.html': '/visitor_log.html',
  '/visitors_log': '/visitor_log.html',
  '/visitor_log': '/visitor_log.html',
  '/visitors': '/visitors.html',
  '/visitors/': '/visitors.html',
  '/my_fear.php': '/my_fear',
};

/** Old medical-term phobia URLs → English fear-of-* bento pages. */
const LATIN_PHOBIA_REDIRECTS = {
  '/aerophobia': '/fear-of-flying',
  '/acrophobia': '/fear-of-heights',
  '/aquaphobia': '/fear-of-water',
  '/amaxophobia': '/fear-of-driving',
  '/claustrophobia': '/fear-of-enclosed-spaces',
  '/glossophobia': '/fear-of-public-speaking',
  '/agoraphobia': '/fear-of-open-spaces',
  '/arachnophobia': '/fear-of-spiders',
  '/katsaridaphobia': '/fear-of-roaches',
  '/ophidiophobia': '/fear-of-snakes',
  '/cynophobia': '/fear-of-dogs',
  '/astraphobia': '/fear-of-storms',
  '/nyctophobia': '/fear-of-the-dark',
  '/coulrophobia': '/fear-of-clowns',
  '/nosocomephobia': '/fear-of-hospitals',
  '/iatrophobia': '/fear-of-doctors',
  '/pteridophobia': '/fear-of-ferns',
  '/botanophobia': '/fear-of-plants',
  '/trypanophobia': '/fear-of-needles',
  '/hemophobia': '/fear-of-blood',
  '/emetophobia': '/fear-of-being-sick',
  '/mysophobia': '/fear-of-germs',
  '/telephobia': '/fear-of-phone-calls',
  '/sales-call-anxiety': '/fear-of-sales-calls',
  '/rejection-sensitivity': '/fear-of-rejection',
  '/rejection-sensitive-dysphoria': '/fear-of-rejection-sensitivity',
  '/dentophobia': '/fear-of-the-dentist',
  '/enochlophobia': '/fear-of-crowds',
  '/gerascophobia': '/fear-of-aging',
  '/eisoptrophobia': '/fear-of-mirrors',
  '/scopophobia': '/fear-of-being-stared-at',
  '/decidophobia': '/fear-of-making-decisions',
  '/deipnophobia': '/fear-of-eating-in-public',
};

async function adminPage(pathname, request, env) {
  const dest = ADMIN_PAGES[pathname];
  if (!dest) return null;
  // Fear/my_fear still redirect; admin HTML is served in-place so browsers
  // don't keep a stale /visitor_log.html while /admin is bookmarked.
  if (dest === '/my_fear') {
    return Response.redirect(new URL(dest, request.url), 302);
  }
  const res = await env.ASSETS.fetch(new Request(new URL(dest, request.url), request));
  if (res.status === 404) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(res.body, { status: res.status, headers });
}

function latinPhobiaRedirect(pathname, request) {
  const dest = LATIN_PHOBIA_REDIRECTS[pathname];
  if (!dest) return null;
  return Response.redirect(new URL(dest, request.url), 301);
}

function rewriteLegacyApi(url) {
  const u = new URL(url);
  const p = u.pathname;

  // Exact /track only — never swallow /tracker.js (static pages load that script).
  if (p === '/cursor_track.php' || p === '/track') {
    u.pathname = '/track';
    return u.toString();
  }
  if (p === '/chat_handler.php' || p.startsWith('/api/chat')) {
    u.pathname = p.replace('/chat_handler.php', '/api/chat').replace(/^\/api\/chat/, '') || '/';
    if (!u.pathname.startsWith('/api/chat')) u.pathname = '/api/chat' + (u.pathname === '/' ? '' : u.pathname);
    return u.toString();
  }
  if (p === '/steven_status.php') {
    u.pathname = '/api/chat/status';
    return u.toString();
  }
  if (p === '/consult_handler.php' || p.startsWith('/api/consult')) {
    const action = u.searchParams.get('action');
    // Keep modern REST paths intact; only rewrite legacy consult_handler.php
    if (p === '/api/consult/slots' || p === '/api/consult/book' || p === '/api/consult/update') {
      return u.toString();
    }
    if (action === 'get_slots' || p.includes('slots')) u.pathname = '/api/consult/slots';
    else if (action === 'update' || p.includes('update')) u.pathname = '/api/consult/update';
    else u.pathname = '/api/consult/book';
    u.search = '';
    return u.toString();
  }
  return url;
}

function rewriteStatic(url) {
  const u = new URL(url);
  let p = u.pathname;

  if (p === '/' || p === '/index.php') {
    u.pathname = '/index.html';
    return u.toString();
  }
  if (p.endsWith('.php')) {
    u.pathname = p.replace(/\.php$/, '.html');
    return u.toString();
  }
  if (p.startsWith('/welcome-') && !p.includes('.')) {
    u.pathname = p + '.html';
    return u.toString();
  }
  if (
    (p === '/pfl-privacy' || p === '/pfl-terms' || p === '/pfl-contact') ||
    (p.startsWith('/pfl-') && !p.includes('.'))
  ) {
    u.pathname = p.replace(/\/$/, '') + '.html';
    return u.toString();
  }
  return url;
}

function fearSlugFromPath(pathname) {
  if (
    pathname === '/my_fear' ||
    pathname === '/my_fear/' ||
    pathname === '/my_fear.html' ||
    pathname === '/my_fear.php'
  ) {
    return 'my_fear';
  }
  const bare = pathname.match(/^\/(fear-of-[a-z0-9-]+)\/?$/i);
  if (bare) return bare[1];
  const html = pathname.match(/^\/(fear-of-[a-z0-9-]+)\.html$/i);
  if (html) return html[1];
  return null;
}

function fearCssSlugFromPath(pathname) {
  if (pathname === '/my_fear/styles.css') return 'my_fear';
  const m = pathname.match(/^\/(fear-of-[a-z0-9-]+)\/styles\.css$/i);
  return m ? m[1] : null;
}

async function dispatchApi(request, env, ctx) {
  const rewritten = new URL(rewriteLegacyApi(request.url));
  const req = new Request(rewritten.toString(), request);
  const path = rewritten.pathname;

  if (path === '/track') return tracker.fetch(req, env, ctx);
  if (path.startsWith('/api/consult')) return consult.fetch(req, env, ctx);
  if (path.startsWith('/api/crm')) return crm.fetch(req, env, ctx);
  if (path.startsWith('/api/email')) return emailApi.fetch(req, env, ctx);
  if (
    path === '/api/login' || path === '/api/logout' ||
    path === '/api/sessions' || path === '/api/chats' || path === '/api/replay' || path === '/api/delete' ||
    path === '/api/forgot-password' || path === '/api/reset-password' || path === '/api/change-password'
  ) return admin.fetch(req, env, ctx);
  if (path.startsWith('/api/payment')) return payment.fetch(req, env, ctx);
  if (path.startsWith('/api/editor')) return editor.fetch(req, env, ctx);
  if (path.startsWith('/api/chat')) {
    const chatUrl = new URL(req.url);
    chatUrl.pathname = path.replace(/^\/api\/chat/, '') || '/';
    return chat.fetch(new Request(chatUrl.toString(), req), env, ctx);
  }
  if (path.startsWith('/file/')) {
    return chat.fetch(req, env, ctx);
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const adminRes = await adminPage(path, request, env);
    if (adminRes) return adminRes;

    const latinRes = latinPhobiaRedirect(path, request);
    if (latinRes) return latinRes;

    if (/^\/(?:fear-of-[a-z0-9-]+|my_fear)\/img\//i.test(path)) {
      const override = await serveSiteImageOverride(env, path);
      if (override) return override;
    }

    if (
      path === '/cursor_track.php' ||
      path === '/chat_handler.php' ||
      path === '/steven_status.php' ||
      path === '/consult_handler.php' ||
      path === '/track' ||
      path.startsWith('/api/') ||
      path.startsWith('/file/')
    ) {
      return dispatchApi(request, env, ctx);
    }

    if (path === '/editor' || path === '/editor/') {
      return env.ASSETS.fetch(new Request(new URL('/editor.html', url.origin), request));
    }

    // Shared visitor tracker for static pages (services, payment, thank-you…).
    // Served from the SAME source as composed pages (R2 override → editor-src
    // asset), so there is exactly one tracker to maintain and every page —
    // composed or static — always runs the current version.
    if (path === '/tracker.js') {
      try {
        const inc = await loadEditorText(env, 'includes/tracker.html');
        if (inc) {
          const js = inc
            .replace(/^\s*<script[^>]*>/i, '')
            .replace(/<\/script>\s*$/i, '');
          return new Response(js, {
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'public, max-age=60',
            },
          });
        }
      } catch (e) {}
      return new Response('', {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      });
    }

    // Edge cache for live-composed pages. Worker responses aren't cached by
    // Cloudflare automatically, so without this every request (and every
    // /visitors mirror iframe) pays the full ~700ms rebuild from R2. Key by
    // pathname only so ?notrack=1 mirror loads share the cache. 30s TTL keeps
    // /editor edits appearing quickly.
    const cache = caches.default;
    const composeCacheKey =
      request.method === 'GET'
        ? new Request(url.origin + url.pathname)
        : null;

    // Live-composed fear CSS (picks up /editor CSS + page photo)
    const cssSlug = fearCssSlugFromPath(path);
    if (cssSlug) {
      if (composeCacheKey) {
        const hit = await cache.match(composeCacheKey);
        if (hit) return hit;
      }
      try {
        const css = await composePageCss(env, cssSlug);
        if (css) {
          const resp = new Response(css, {
            headers: {
              'content-type': 'text/css; charset=utf-8',
              'cache-control': 'public, max-age=30',
            },
          });
          if (composeCacheKey) ctx.waitUntil(cache.put(composeCacheKey, resp.clone()));
          return resp;
        }
      } catch (_) {}
    }

    // Live-composed fear HTML (picks up copy / includes / body edits)
    const fearSlug = fearSlugFromPath(path);
    if (fearSlug) {
      if (composeCacheKey) {
        const hit = await cache.match(composeCacheKey);
        if (hit) return hit;
      }
      try {
        const html = await composeFearPage(env, fearSlug);
        if (html) {
          const resp = new Response(html, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'public, max-age=30',
            },
          });
          if (composeCacheKey) ctx.waitUntil(cache.put(composeCacheKey, resp.clone()));
          return resp;
        }
      } catch (_) {}
    }

    const staticUrl = rewriteStatic(request.url);
    const assetReq = staticUrl !== request.url
      ? new Request(staticUrl, request)
      : request;

    if (path === '/' || path === '/index.php') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), request));
    }

    const res = await env.ASSETS.fetch(assetReq);
    if (res.status !== 404) return res;

    if (!path.includes('.')) {
      const tryHtml = await env.ASSETS.fetch(
        new Request(new URL(path + '.html', url.origin), request)
      );
      if (tryHtml.status !== 404) return tryHtml;
    }

    return res;
  },

  async scheduled(event, env, ctx) {
    if (consult.scheduled) {
      ctx.waitUntil(consult.scheduled(event, env, ctx));
    }
    ctx.waitUntil(
      pollEvolveAgents(env).catch((e) => console.error('pollEvolveAgents', e?.message || e)),
    );
    ctx.waitUntil(
      autoSyncGoogleAds(env).catch((e) => console.error('autoSyncGoogleAds', e?.message || e)),
    );
  },
};
