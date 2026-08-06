#!/usr/bin/env node
/**
 * Verify Thought #26: therapy session status controls are color-coded —
 * scheduled = green, completed = blue, cancelled = red, no-show = black/white.
 * Run: node scripts/verify-thought-26.js
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
  '.badge-scheduled{background:#16a34a;',
  '.badge-no-show{background:#111;color:#fff;}',
  '.badge-completed{background:#2563eb;',
  '.badge-cancelled{background:#dc2626;',
  '.status-select.status-scheduled{background:#16a34a;',
  '.status-select.status-completed{background:#2563eb;',
  '.status-select.status-cancelled{background:#dc2626;',
  '.status-select.status-no-show{background:#111;',
  "class=\"status-select status-' + escapeHtml(status) + '\"",
  'updateSessionStatus(',
  'this.className=\\\'status-select status-\\\'+this.value;updateSessionStatus',
];

const missing = markers.filter(function (m) {
  return !uiHtml.includes(m);
});
if (missing.length) {
  console.error('Missing Thought #26 markers:');
  missing.forEach(function (m) {
    console.error(' -', m);
  });
  process.exit(1);
}

console.log(
  'OK: Thought #26 therapy session status colors present and template synced.'
);

