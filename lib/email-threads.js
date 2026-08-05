/**
 * Participant-aware email conversation grouping.
 *
 * Upstream inhouse-email-worker can merge outbound messages that share a
 * subject into one thread even when the recipients differ. Admin list/detail
 * should treat each (mailbox, counterpart, normalized subject) as its own
 * conversation so two "Hello" sends to Alice and Bob appear as two rows.
 */

const LOCAL_THREAD_PREFIX = 'pfsplit:';

export function extractEmailAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const angle = s.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : s).trim();
  const m = candidate.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return (m ? m[0] : candidate).toLowerCase();
}

export function normalizeEmailSubject(subject) {
  let s = String(subject || '').trim();
  // Strip common reply/forward prefixes repeatedly.
  let prev;
  do {
    prev = s;
    s = s.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
  } while (s !== prev);
  return s.toLowerCase() || '(no subject)';
}

/**
 * External participant for a message relative to our mailbox.
 * Outbound → To; inbound → From.
 */
export function messageCounterpart(msg, mailbox) {
  const box = extractEmailAddress(mailbox || msg.mailbox || '');
  const from = extractEmailAddress(msg.from);
  const to = extractEmailAddress(msg.to);
  const direction = String(msg.direction || '').toLowerCase();

  if (direction === 'outbound' || (box && from === box)) {
    return to || extractEmailAddress(msg.to) || from;
  }
  if (direction === 'inbound' || (box && to === box)) {
    return from || to;
  }
  // Fallback: whichever side is not the mailbox.
  if (box && from === box) return to || from;
  if (box && to === box) return from || to;
  return from || to || '';
}

export function conversationKey(mailbox, counterpart, subject) {
  const box = extractEmailAddress(mailbox) || String(mailbox || '').toLowerCase();
  const who = extractEmailAddress(counterpart) || String(counterpart || '').toLowerCase();
  const sub = normalizeEmailSubject(subject);
  return `${box}\n${who}\n${sub}`;
}

function utf8ToBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(b64url) {
  const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeThreadId(mailbox, counterpart, subject) {
  const key = conversationKey(mailbox, counterpart, subject);
  return LOCAL_THREAD_PREFIX + utf8ToBase64Url(key);
}

export function decodeThreadId(threadId) {
  const id = String(threadId || '');
  if (!id.startsWith(LOCAL_THREAD_PREFIX)) return null;
  try {
    const raw = base64UrlToUtf8(id.slice(LOCAL_THREAD_PREFIX.length));
    const parts = raw.split('\n');
    if (parts.length < 3) return null;
    return {
      mailbox: parts[0],
      counterpart: parts[1],
      subject: parts.slice(2).join('\n'),
    };
  } catch {
    return null;
  }
}

export function isLocalThreadId(threadId) {
  return String(threadId || '').startsWith(LOCAL_THREAD_PREFIX);
}

function messageTime(m) {
  const t = Date.parse(m.receivedAt || m.date || m.sentAt || '') || 0;
  return t;
}

function messagePreview(m) {
  const text = String(m.text || m.preview || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 160);
}

/**
 * Build conversation rows from a flat message list.
 * Groups by mailbox + counterpart + normalized subject.
 */
export function buildConversationsFromMessages(messages, mailbox) {
  const groups = new Map();
  const list = Array.isArray(messages) ? messages : [];

  for (const msg of list) {
    const box = extractEmailAddress(mailbox || msg.mailbox || msg.to || msg.from);
    const counterpart = messageCounterpart(msg, box);
    const subject = msg.subject || '(no subject)';
    const key = conversationKey(box, counterpart, subject);
    let g = groups.get(key);
    if (!g) {
      g = {
        mailbox: box,
        counterpart,
        subjectNorm: normalizeEmailSubject(subject),
        subjectRaw: subject,
        messages: [],
      };
      groups.set(key, g);
    }
    g.messages.push(msg);
    // Prefer a non-Re: subject for display when available.
    const cleaned = String(subject || '').replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
    if (cleaned && !/^(re|fw|fwd)\s*:/i.test(String(g.subjectRaw || ''))) {
      // keep existing if already clean
    } else if (cleaned) {
      g.subjectRaw = cleaned;
    }
  }

  const conversations = [];
  for (const g of groups.values()) {
    g.messages.sort((a, b) => messageTime(a) - messageTime(b));
    const latest = g.messages[g.messages.length - 1] || {};
    const unread = g.messages.reduce((n, m) => n + (m.read ? 0 : 1), 0);
    const displaySubject =
      String(g.subjectRaw || '').replace(/^(re|fw|fwd)\s*:\s*/gi, '').trim() ||
      '(no subject)';
    // List "from" column: show the other party (recipient for sent mail).
    const displayParty =
      g.counterpart ||
      extractEmailAddress(latest.from) ||
      extractEmailAddress(latest.to) ||
      '';

    conversations.push({
      threadId: encodeThreadId(g.mailbox, g.counterpart, g.subjectNorm),
      from: displayParty,
      to: g.counterpart,
      subject: displaySubject,
      preview: messagePreview(latest),
      latestAt: latest.receivedAt || latest.date || latest.sentAt || null,
      messageCount: g.messages.length,
      unread,
      mailbox: g.mailbox,
      messageIds: g.messages.map((m) => m.id).filter((id) => id != null),
      // Not always sent to clients; useful server-side.
      _messages: g.messages,
    });
  }

  conversations.sort((a, b) => {
    const tb = Date.parse(b.latestAt || '') || 0;
    const ta = Date.parse(a.latestAt || '') || 0;
    return tb - ta;
  });

  return conversations;
}

/** Filter flat messages that belong to a local thread id. */
export function messagesForThreadId(messages, threadId, mailbox) {
  const decoded = decodeThreadId(threadId);
  if (!decoded) return null;
  const box = extractEmailAddress(mailbox || decoded.mailbox);
  const who = extractEmailAddress(decoded.counterpart);
  const sub = normalizeEmailSubject(decoded.subject);
  const list = (Array.isArray(messages) ? messages : []).filter((m) => {
    const mBox = extractEmailAddress(mailbox || m.mailbox || m.to || m.from);
    if (box && mBox && mBox !== box) return false;
    const counterpart = messageCounterpart(m, box || mBox);
    if (extractEmailAddress(counterpart) !== who) return false;
    return normalizeEmailSubject(m.subject) === sub;
  });
  list.sort((a, b) => messageTime(a) - messageTime(b));
  return list;
}

/** Public conversation objects (strip internal _messages). */
export function publicConversations(conversations) {
  return (conversations || []).map((c) => {
    const { _messages, ...rest } = c;
    return rest;
  });
}
