#!/usr/bin/env node
/**
 * Verify Thought #25: consultation status controls are color-coded —
 * confirmed = lime green, completed = blue, cancelled = red.
 * Run: node scripts/verify-thought-25.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ui = path.join(root, 'public/visitor_log.html');
const tpl = path.join(root, 'scripts/visitor-log-template.html');

const uiHtml = fs.readFileSync(ui, 'utf8');
const tplHtml = fs.readFileSync(tpl, 'utf8');

if (uiHtml !== tplHtml) {
  console.error('MISMATCH: public/visitor_log.html !== scripts/visitor-log-template.html');
  process.exit(1);
}

const markers = [
  '.badge-confirmed{background:#b8f000;',
  '.badge-completed{background:#2563eb;',
  '.badge-cancelled{background:#dc2626;',
  '.status-select.status-confirmed{background:#b8f000;',
  '.status-select.status-completed{background:#2563eb;',
  '.status-select.status-cancelled{background:#dc2626;',
  "class=\"status-select status-' + escapeHtml(status) + '\"",
  'this.className=\\\'status-select status-\\\'+this.value',
];

const missing = markers.filter(function (m) {
  return !uiHtml.includes(m);
});
if (missing.length) {
  console.error('Missing Thought #25 markers:');
  missing.forEach(function (m) {
    console.error(' -', m);
  });
  process.exit(1);
}

console.log(
  'OK: Thought #25 consultation status colors present and template synced.'
);
