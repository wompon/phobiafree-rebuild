/**
 * Thought #22 — same-subject emails to different people must not merge.
 * Run: node scripts/verify-thought-22.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConversationsFromMessages,
  decodeThreadId,
  messagesForThreadId,
  normalizeEmailSubject,
} from '../lib/email-threads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertFileContains(rel, needles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const n of needles) {
    assert.ok(text.includes(n), `${rel} missing: ${n}`);
  }
}

const mailbox = 'steve@phobiafree.life';
const msgs = [
  {
    id: 1,
    direction: 'outbound',
    from: 'Steve <steve@phobiafree.life>',
    to: 'Alice <alice@example.com>',
    subject: 'Hello',
    text: 'Hi Alice',
    receivedAt: '2026-08-01T10:00:00Z',
    read: true,
  },
  {
    id: 2,
    direction: 'outbound',
    from: 'Steve <steve@phobiafree.life>',
    to: 'Bob <bob@example.com>',
    subject: 'Hello',
    text: 'Hi Bob',
    receivedAt: '2026-08-01T10:01:00Z',
    read: true,
  },
  {
    id: 3,
    direction: 'inbound',
    from: 'Alice <alice@example.com>',
    to: 'steve@phobiafree.life',
    subject: 'Re: Hello',
    text: 'Thanks',
    receivedAt: '2026-08-01T11:00:00Z',
    read: false,
  },
];

const conv = buildConversationsFromMessages(msgs, mailbox);
assert.equal(conv.length, 2, 'two recipients → two conversations');
const alice = conv.find((c) => c.from === 'alice@example.com');
const bob = conv.find((c) => c.from === 'bob@example.com');
assert.ok(alice && bob, 'both counterparties listed');
assert.equal(alice.messageCount, 2);
assert.equal(bob.messageCount, 1);
assert.notEqual(alice.threadId, bob.threadId);
assert.equal(alice.unread, 1);
assert.equal(normalizeEmailSubject('Re: Fwd: Hello'), 'hello');
assert.equal(decodeThreadId(alice.threadId).counterpart, 'alice@example.com');
assert.deepEqual(
  messagesForThreadId(msgs, bob.threadId, mailbox).map((m) => m.id),
  [2]
);

const samePerson = buildConversationsFromMessages(
  [
    {
      id: 10,
      direction: 'outbound',
      from: mailbox,
      to: 'carol@x.com',
      subject: 'Appt',
      text: 'a',
      receivedAt: '2026-08-02T10:00:00Z',
      read: true,
    },
    {
      id: 11,
      direction: 'outbound',
      from: mailbox,
      to: 'carol@x.com',
      subject: 'Re: Appt',
      text: 'b',
      receivedAt: '2026-08-02T10:05:00Z',
      read: true,
    },
  ],
  mailbox
);
assert.equal(samePerson.length, 1);
assert.equal(samePerson[0].messageCount, 2);

assertFileContains('email-api-worker.js', [
  'buildConversationsFromMessages',
  'handleInboxList',
  'isLocalThreadId',
  'Thought #22',
]);
assertFileContains('lib/email-threads.js', ['pfsplit:', 'messageCounterpart']);
assertFileContains('scripts/visitor-log-template.html', [
  'Thought #22',
  'messageIds',
  'decodeURIComponent',
]);
assertFileContains('public/visitor_log.html', [
  'Thought #22',
  'messageIds',
  'decodeURIComponent',
]);

const tpl = fs.readFileSync(path.join(root, 'scripts/visitor-log-template.html'), 'utf8');
const pub = fs.readFileSync(path.join(root, 'public/visitor_log.html'), 'utf8');
assert.equal(tpl, pub, 'visitor_log.html must match template');

console.log('Thought #22 verification OK');
