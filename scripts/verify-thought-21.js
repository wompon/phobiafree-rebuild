#!/usr/bin/env node
/**
 * Verify Thought #21: visitor log rows stay inside their container.
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
  '.vlog-scroll{overflow-x:auto',
  'grid-template-columns:28px minmax(0,1.1fr)',
  '.vlog-row > *{min-width:0;}',
  'class="vlog-scroll"',
  'table-wrap vlog-hits',
  '.vlog-cell-text',
  'max-height:2.6em;overflow:hidden;min-width:0;}',
];

const missing = markers.filter(function(m) { return !uiHtml.includes(m); });
if (missing.length) {
  console.error('Missing Thought #21 markers:');
  missing.forEach(function(m) { console.error(' -', m); });
  process.exit(1);
}

console.log('OK: Thought #21 visitor-log overflow fix present and template synced.');
