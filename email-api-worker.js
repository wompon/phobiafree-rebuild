/**
 * Admin email inbox proxy → inhouse-email-worker.
 * Auth: admin session cookie. Upstream: Bearer EMAIL_INBOX_API_KEY.
 *
 * Thought #22/#24: rebuild conversation list/detail so same-subject emails to
 * different recipients are not collapsed into one thread. Never return the
 * upstream conversation list as-is — that payload can already be subject-merged.
 */
import { setRequestOrigin, json, requireAuth } from './lib/admin-auth.js';
import {
  buildConversationsFromMessages,
  extractMessagesFromUpstream,
  isLocalThreadId,
  messagesForThreadId,
  publicConversations,
  syntheticMessagesFromConversations,
} from './lib/email-threads.js';

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
        return handleInboxList(env, url);
      }

      const thread = path.match(/^\/api\/email\/inbox\/thread\/([^/]+)$/);
      if (thread && request.method === 'GET') {
        return handleThread(env, url, decodeURIComponent(thread[1]));
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
        const bodyText = await request.text();
        return handleBulk(env, bodyText);
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

async function handleInboxList(env, url) {
  const flat = url.searchParams.get('flat');
  // Flat mode stays a passthrough for unread/contact scans.
  if (flat === '1' || flat === 'true') {
    return proxyInbox(env, '/inbox' + url.search, 'GET');
  }

  const folder = url.searchParams.get('folder') || 'inbox';
  const mailbox =
    url.searchParams.get('to') ||
    url.searchParams.get('mailbox') ||
    '';
  const limit = url.searchParams.get('limit') || '100';

  const qs = new URLSearchParams();
  qs.set('limit', limit);
  qs.set('folder', folder);
  qs.set('flat', '1');
  if (mailbox) {
    qs.set('to', mailbox);
    qs.set('mailbox', mailbox);
  }

  const upstream = await upstreamJson(env, '/inbox?' + qs.toString(), 'GET');
  if (!upstream.ok) {
    return json(upstream.data, upstream.status);
  }

  // Thought #24: always rebuild. Never return upstream.conversations as-is —
  // that list can merge same-subject Sent mail across different recipients.
  let messages = extractMessagesFromUpstream(upstream.data);

  // Flat=1 sometimes returns only conversation summaries. Retry without flat
  // so we can pull nested per-message payloads, then expand messageIds.
  if (!messages.length && Array.isArray(upstream.data.conversations)) {
    const qsNested = new URLSearchParams(qs);
    qsNested.delete('flat');
    const nested = await upstreamJson(env, '/inbox?' + qsNested.toString(), 'GET');
    if (nested.ok) {
      messages = extractMessagesFromUpstream(nested.data);
    }
  }

  if (!messages.length && Array.isArray(upstream.data.conversations)) {
    messages = await expandConversationsViaMessageIds(
      env,
      upstream.data.conversations,
      mailbox
    );
  }

  if (!messages.length && Array.isArray(upstream.data.conversations)) {
    // Final rebuild input: synthetic one-message-per-recipient rows.
    // Still never passthrough upstream merged thread ids.
    messages = syntheticMessagesFromConversations(
      upstream.data.conversations,
      mailbox
    );
  }

  const conversations = publicConversations(
    buildConversationsFromMessages(messages, mailbox)
  );

  return json({
    ok: true,
    conversations,
    // Keep messages available for older clients; list UI uses conversations.
    messages,
    folder,
    mailbox: mailbox || undefined,
  });
}

/**
 * When summaries expose messageIds but not message bodies, fetch each message
 * so counterpart+subject splitting can see real To: recipients.
 */
async function expandConversationsViaMessageIds(env, conversations, mailbox) {
  const ids = [];
  const seen = new Set();
  for (const c of conversations || []) {
    const list = Array.isArray(c?.messageIds)
      ? c.messageIds
      : Array.isArray(c?.message_ids)
        ? c.message_ids
        : [];
    for (const id of list) {
      if (id == null || id === '' || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  if (!ids.length) return [];

  // Bound fan-out so a large Sent folder cannot stall the admin list.
  const capped = ids.slice(0, 80);
  const messages = [];
  for (const id of capped) {
    try {
      const r = await upstreamJson(env, '/inbox/' + encodeURIComponent(id), 'GET');
      if (!r.ok) continue;
      const msg = r.data?.message || r.data;
      if (msg && typeof msg === 'object' && (msg.id != null || msg.subject || msg.from)) {
        if (mailbox && !msg.mailbox) msg.mailbox = mailbox;
        messages.push(msg);
      }
    } catch {
      // skip individual failures
    }
  }
  return messages;
}

async function handleThread(env, url, threadId) {
  const mailbox =
    url.searchParams.get('mailbox') ||
    url.searchParams.get('to') ||
    '';

  if (!isLocalThreadId(threadId)) {
    // Legacy upstream thread ids — still proxy, but split if mixed parties.
    const upstream = await upstreamJson(
      env,
      '/inbox/thread/' + encodeURIComponent(threadId) + url.search,
      'GET'
    );
    if (!upstream.ok) {
      return json(upstream.data, upstream.status);
    }
    const msgs = upstream.data.messages || [];
    const split = buildConversationsFromMessages(msgs, mailbox);
    if (split.length <= 1) {
      return json(upstream.data, upstream.status);
    }
    // Ambiguous legacy id with mixed recipients: return first group only
    // (admin list now uses local ids, so this is a rare fallback).
    return json({
      ok: true,
      messages: split[0]._messages || msgs,
      threadId,
      splitHint: split.length,
    });
  }

  const folder = url.searchParams.get('folder') || 'all';
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  qs.set('folder', folder === 'sent' ? 'sent' : folder);
  qs.set('flat', '1');
  if (mailbox) {
    qs.set('to', mailbox);
    qs.set('mailbox', mailbox);
  }

  // Prefer the active folder, then fall back to all so replies still resolve.
  let messages = [];
  const foldersToTry = folder === 'all' ? ['all'] : [folder, 'all', 'sent', 'inbox'];
  const seen = new Set();
  for (const f of foldersToTry) {
    if (seen.has(f)) continue;
    seen.add(f);
    qs.set('folder', f);
    const upstream = await upstreamJson(env, '/inbox?' + qs.toString(), 'GET');
    if (!upstream.ok) continue;
    const flat = upstream.data.messages || [];
    const matched = messagesForThreadId(flat, threadId, mailbox);
    if (matched && matched.length) {
      messages = matched;
      break;
    }
    // Keep scanning; may exist only in sent/inbox.
  }

  if (!messages.length) {
    // Last resort: search without folder filter if upstream supports it.
    qs.set('folder', 'all');
    const upstream = await upstreamJson(env, '/inbox?' + qs.toString(), 'GET');
    if (upstream.ok) {
      messages = messagesForThreadId(upstream.data.messages || [], threadId, mailbox) || [];
    }
  }

  return json({
    ok: true,
    threadId,
    messages,
  });
}

async function handleBulk(env, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText || '{}');
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const threadIds = Array.isArray(body.threadIds) ? body.threadIds : [];
  const localIds = threadIds.filter(isLocalThreadId);
  const upstreamIds = threadIds.filter((id) => !isLocalThreadId(id));

  // Pure upstream bulk — passthrough.
  if (!localIds.length) {
    return proxyInbox(env, '/inbox/bulk', 'POST', bodyText);
  }

  const action = String(body.action || '');
  const mailbox = body.mailbox || '';
  const folder = body.folder;
  const activeFolder = body.activeFolder || 'all';

  const messageIds = new Set();
  if (Array.isArray(body.messageIds)) {
    body.messageIds.forEach((id) => {
      if (id != null && id !== '') messageIds.add(id);
    });
  }

  // Resolve local thread ids → message ids via flat inbox when needed.
  if (localIds.length && messageIds.size === 0) {
    const qs = new URLSearchParams();
    qs.set('limit', '200');
    qs.set('folder', activeFolder || 'all');
    qs.set('flat', '1');
    if (mailbox) {
      qs.set('to', mailbox);
      qs.set('mailbox', mailbox);
    }
    const foldersToTry = [activeFolder, 'all', 'sent', 'inbox'].filter(Boolean);
    const seenFolders = new Set();
    for (const f of foldersToTry) {
      if (seenFolders.has(f)) continue;
      seenFolders.add(f);
      qs.set('folder', f);
      const upstream = await upstreamJson(env, '/inbox?' + qs.toString(), 'GET');
      if (!upstream.ok) continue;
      const flat = upstream.data.messages || [];
      for (const tid of localIds) {
        const matched = messagesForThreadId(flat, tid, mailbox) || [];
        matched.forEach((m) => {
          if (m && m.id != null) messageIds.add(m.id);
        });
      }
    }
  }

  const errors = [];
  let affected = 0;

  for (const id of messageIds) {
    try {
      const result = await applyMessageAction(env, id, action, folder);
      if (!result.ok) {
        errors.push({ id, error: result.error || 'failed' });
      } else {
        affected++;
      }
    } catch (e) {
      errors.push({ id, error: String(e) });
    }
  }

  // Also forward any legacy upstream thread ids.
  if (upstreamIds.length) {
    const forwarded = await upstreamJson(
      env,
      '/inbox/bulk',
      'POST',
      JSON.stringify({
        ...body,
        threadIds: upstreamIds,
      })
    );
    if (!forwarded.ok) {
      errors.push({
        threadIds: upstreamIds,
        error: forwarded.data.error || 'upstream bulk failed',
      });
    } else if (typeof forwarded.data.affected === 'number') {
      affected += forwarded.data.affected;
    }
  }

  return json({
    ok: errors.length === 0,
    affected,
    errors: errors.length ? errors : undefined,
  }, errors.length && !affected ? 502 : 200);
}

async function applyMessageAction(env, id, action, folder) {
  if (action === 'delete') {
    return upstreamJson(env, '/inbox/' + id + '?force=1', 'DELETE');
  }
  if (action === 'move') {
    return upstreamJson(
      env,
      '/inbox/' + id + '/move',
      'POST',
      JSON.stringify({ folder })
    );
  }
  if (['read', 'unread', 'trash', 'archive', 'restore'].includes(action)) {
    return upstreamJson(env, '/inbox/' + id + '/' + action, 'POST', '{}');
  }
  return { ok: false, status: 400, data: { error: 'unsupported action' }, error: 'unsupported action' };
}

async function proxyInbox(env, upstreamPath, method, body) {
  const result = await upstreamJson(env, upstreamPath, method, body);
  return json(result.data, result.status);
}

async function upstreamJson(env, upstreamPath, method, body) {
  const key = env.EMAIL_INBOX_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      data: { error: 'EMAIL_INBOX_API_KEY secret not configured' },
      error: 'EMAIL_INBOX_API_KEY secret not configured',
    };
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
    return {
      ok: false,
      status: res.status || 502,
      data: { error: 'Upstream error', detail: text.slice(0, 300) },
      error: 'Upstream error',
    };
  }
  return {
    ok: res.ok && data.ok !== false,
    status: res.status,
    data,
    error: data.error,
  };
}
