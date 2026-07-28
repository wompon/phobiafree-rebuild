#!/usr/bin/env node
/**
 * Verify Thought #18 admin archive/checkbox/delete wiring is present.
 * Exit 0 on success; prints missing markers otherwise.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  ui: path.join(root, 'public/visitor_log.html'),
  tpl: path.join(root, 'scripts/visitor-log-template.html'),
  crm: path.join(root, 'crm-api-worker.js'),
  schema: path.join(root, 'schema.sql'),
};

const required = {
  ui: [
    'SHOW_ARCHIVED_VISITORS',
    'SHOW_ARCHIVED_CONSULTS',
    'SELECTED_VISITOR_VIDS',
    'SELECTED_PAGE_HIT_IDS',
    'bulkArchiveVisitors',
    'bulkDeleteVisitors',
    'bulkArchivePageHits',
    'bulkDeletePageHits',
    'archiveVisitor',
    'archivePageHit',
    'archiveConsult',
    'toggleSelectAllVisitors',
    'toggleSelectAllPageHits',
    'vlog-check',
    'bulk-bar',
  ],
  tpl: [
    'archiveConsult',
    'bulkArchiveVisitors',
    'SHOW_ARCHIVED_VISITORS',
  ],
  crm: [
    "case 'archive_visitors'",
    "case 'archive_page_hits'",
    "case 'archive_consultation'",
    "case 'delete_visitors'",
    "case 'delete_page_hits'",
    'ensureArchiveColumns',
    'ALTER TABLE visitor_log ADD COLUMN archived',
    'ALTER TABLE page_hits ADD COLUMN archived',
    'ALTER TABLE consultations ADD COLUMN archived',
  ],
  schema: [
    'archived INTEGER DEFAULT 0',
    'CREATE TABLE IF NOT EXISTS page_hits',
  ],
};

let ok = true;
for (const [key, markers] of Object.entries(required)) {
  const text = fs.readFileSync(files[key], 'utf8');
  for (const m of markers) {
    if (!text.includes(m)) {
      console.error('MISSING', key + ':', m);
      ok = false;
    }
  }
}

const ui = fs.readFileSync(files.ui, 'utf8');
const tpl = fs.readFileSync(files.tpl, 'utf8');
if (ui !== tpl) {
  console.error('MISMATCH: public/visitor_log.html !== scripts/visitor-log-template.html');
  ok = false;
}

if (!ok) process.exit(1);
console.log('Thought #18 markers OK (UI/template/CRM/schema).');
