/**
 * Thought #24 — email flat fallback must not return upstream merged threads;
 * visitor log Delete/Archive buttons must remain real buttons (not ".....").
 * Run: node scripts/verify-thought-24.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConversationsFromMessages,
  extractMessagesFromUpstream,
  syntheticMessagesFromConversations,
} from '../lib/email-threads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertFileContains(rel, needles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const n of needles) {
    assert.ok(text.includes(n), `${rel} missing: ${n}`);
  }
}

function assertFileNotContains(rel, needles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const n of needles) {
    assert.ok(!text.includes(n), `${rel} should not contain: ${n}`);
  }
}

const mailbox = 'steve@phobiafree.life';

// Upstream-style merged conversation payload (no flat messages).
const upstreamMerged = {
  ok: true,
  conversations: [
    {
      threadId: 'upstream-merged-hello',
      from: 'Steve <steve@phobiafree.life>',
      to: 'Alice <alice@example.com>, Bob <bob@example.com>',
      subject: 'Hello',
      preview: 'Hi',
      latestAt: '2026-08-01T10:01:00Z',
      messageCount: 2,
      messageIds: [1, 2],
      unread: 0,
    },
  ],
};

assert.equal(
  extractMessagesFromUpstream(upstreamMerged).length,
  0,
  'summary-only payload has no concrete messages'
);

const synth = syntheticMessagesFromConversations(
  upstreamMerged.conversations,
  mailbox
);
assert.equal(synth.length, 2, 'multi-to summary → two synthetic messages');
const rebuilt = buildConversationsFromMessages(synth, mailbox);
assert.equal(rebuilt.length, 2, 'same-subject Sent to two people → two conversations');
assert.ok(rebuilt.every((c) => String(c.threadId).startsWith('pfsplit:')));
assert.ok(rebuilt.find((c) => c.from === 'alice@example.com'));
assert.ok(rebuilt.find((c) => c.from === 'bob@example.com'));

// Nested messages under conversations still extract.
const nested = extractMessagesFromUpstream({
  conversations: [
    {
      threadId: 'x',
      messages: [
        {
          id: 10,
          direction: 'outbound',
          from: mailbox,
          to: 'carol@x.com',
          subject: 'Hi',
          text: 'a',
          receivedAt: '2026-08-02T10:00:00Z',
          read: true,
        },
        {
          id: 11,
          direction: 'outbound',
          from: mailbox,
          to: 'dan@x.com',
          subject: 'Hi',
          text: 'b',
          receivedAt: '2026-08-02T10:01:00Z',
          read: true,
        },
      ],
    },
  ],
});
assert.equal(nested.length, 2);
assert.equal(buildConversationsFromMessages(nested, mailbox).length, 2);

// Worker must not passthrough upstream conversations when flat is empty.
assertFileContains('email-api-worker.js', [
  'Thought #24',
  'extractMessagesFromUpstream',
  'syntheticMessagesFromConversations',
  'expandConversationsViaMessageIds',
  'Never return upstream',
]);
assertFileNotContains('email-api-worker.js', [
  'return json(upstream.data, upstream.status);\n    }\n    return json({\n      ok: true,\n      conversations: [],',
]);

// Visitor log: actions column must not use ellipsis clipping.
for (const rel of ['scripts/visitor-log-template.html', 'public/visitor_log.html']) {
  assertFileContains(rel, [
    'Thought #24',
    'never ellipsis the Actions column',
    'minmax(148px,auto)',
    'deleteVisitor(',
    'deletePageHit(',
    '>Delete</button>',
    'td:last-child{overflow:visible',
  ]);
  assertFileNotContains(rel, ['minmax(0,130px)']);
}

const tpl = fs.readFileSync(path.join(root, 'scripts/visitor-log-template.html'), 'utf8');
const pub = fs.readFileSync(path.join(root, 'public/visitor_log.html'), 'utf8');
assert.equal(tpl, pub, 'visitor_log.html must match template');

console.log('Thought #24 verification OK');
