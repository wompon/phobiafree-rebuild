/**
 * Admin email inbox proxy → inhouse-email-worker.
 * Auth: admin session cookie. Upstream: Bearer EMAIL_INBOX_API_KEY.
 */
import { setRequestOrigin, json, requireAuth } from './lib/admin-auth.js';

const DEFAULT_INBOX_URL = 'https://inhouse-email-worker.soyuzlaunch.workers.dev';

export default {
  async fetch(request, env) {
    setRequestOrigin(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: json({}).headers });
    }

    if (!(await requireAuth(request, env))) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/email/inbox' && request.method === 'GET') {
        return proxyInbox(env, '/inbox' + url.search, 'GET');
      }

      const thread = path.match(/^\/api\/email\/inbox\/thread\/([^/]+)$/);
      if (thread && request.method === 'GET') {
        return proxyInbox(env, '/inbox/thread/' + thread[1] + url.search, 'GET');
      }

      if (path === '/api/email/folders' && request.method === 'GET') {
        return proxyInbox(env, '/folders' + url.search, 'GET');
      }
      if (path === '/api/email/folders' && request.method === 'POST') {
        const body = await request.text();
        return proxyInbox(env, '/folders', 'POST', body);
      }
      const delFolder = path.match(/^\/api\/email\/folders\/([a-z0-9-]+)$/);
      if (delFolder && request.method === 'DELETE') {
        return proxyInbox(env, '/folders/' + delFolder[1], 'DELETE');
      }

      if (path === '/api/email/inbox/bulk' && request.method === 'POST') {
        const body = await request.text();
        return proxyInbox(env, '/inbox/bulk', 'POST', body);
      }

      const one = path.match(/^\/api\/email\/inbox\/(\d+)$/);
      if (one && request.method === 'GET') {
        return proxyInbox(env, '/inbox/' + one[1], 'GET');
      }
      if (one && request.method === 'DELETE') {
        return proxyInbox(env, '/inbox/' + one[1] + url.search, 'DELETE');
      }

      const actions = path.match(
        /^\/api\/email\/inbox\/(\d+)\/(read|unread|reply|move|trash|archive|restore)$/
      );
      if (actions && request.method === 'POST') {
        const body = await request.text();
        return proxyInbox(
          env,
          '/inbox/' + actions[1] + '/' + actions[2],
          'POST',
          body || undefined
        );
      }

      if (path === '/api/email/send' && request.method === 'POST') {
        const body = await request.text();
        return proxyInbox(env, '/send', 'POST', body);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

async function proxyInbox(env, upstreamPath, method, body) {
  const key = env.EMAIL_INBOX_API_KEY;
  if (!key) {
    return json({ error: 'EMAIL_INBOX_API_KEY secret not configured' }, 503);
  }

  const base = (env.EMAIL_INBOX_URL || DEFAULT_INBOX_URL).replace(/\/$/, '');
  const res = await fetch(base + upstreamPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: body != null && method !== 'GET' && method !== 'DELETE' ? body : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ error: 'Upstream error', detail: text.slice(0, 300) }, res.status || 502);
  }
  return json(data, res.status);
}
