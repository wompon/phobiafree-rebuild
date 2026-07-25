/**
 * Convert MySQL dump to D1-compatible SQL and write batched files.
 * Usage: node scripts/import-mysql-to-d1.js [path-to-dump.sql]
 */
const fs = require('fs');
const path = require('path');

const DUMP =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || '',
    'Documents/phobiafree.life/public_html/phobiafree.life/phobiafreelife.sql'
  );
const OUT_DIR = path.join(__dirname, '..', 'import');

const TABLES = [
  'settings',
  'blocked_slots',
  'clients',
  'consultations',
  'payment_links',
  'therapy_sessions',
  'visitor_log',
  'session_snapshots',
  'chat_messages',
];

function convert(sql) {
  let s = sql;
  // Strip phpMyAdmin headers / transactions
  s = s.replace(/^--.*$/gm, '');
  s = s.replace(/\/\*![\s\S]*?\*\/;?/g, '');
  s = s.replace(/SET SQL_MODE[\s\S]*?;/gi, '');
  s = s.replace(/START TRANSACTION;|COMMIT;/gi, '');
  s = s.replace(/SET time_zone[\s\S]*?;/gi, '');
  s = s.replace(/SET NAMES[\s\S]*?;/gi, '');
  s = s.replace(/SET CHARACTER_SET[\s\S]*?;/gi, '');

  // Remove CREATE TABLE blocks — schema.sql owns DDL
  s = s.replace(/CREATE TABLE[\s\S]*?;/gi, '');

  // Remove ALTER TABLE (indexes, auto_increment) — handled in schema.sql
  s = s.replace(/ALTER TABLE[\s\S]*?;/gi, '');

  // MySQL → SQLite type tweaks inside any leftover DDL
  s = s.replace(/ENGINE=\w+[^;]*/gi, '');
  s = s.replace(/DEFAULT CHARSET=\w+[^;]*/gi, '');
  s = s.replace(/COLLATE=\w+[^;]*/gi, '');
  s = s.replace(/AUTO_INCREMENT=\d+/gi, '');
  s = s.replace(/int\(\d+\)/gi, 'INTEGER');
  s = s.replace(/tinyint\(\d+\)/gi, 'INTEGER');
  s = s.replace(/varchar\(\d+\)/gi, 'TEXT');
  s = s.replace(/datetime/gi, 'TEXT');
  s = s.replace(/timestamp/gi, 'TEXT');
  s = s.replace(/INSERT IGNORE/gi, 'INSERT OR IGNORE');

  return s;
}

function extractInserts(sql, table) {
  const re = new RegExp(
    `INSERT INTO \`${table}\`[\\s\\S]*?;`,
    'gi'
  );
  const matches = [...sql.matchAll(re)].map(m => m[0]);
  return matches.join('\n');
}

if (!fs.existsSync(DUMP)) {
  console.error('Dump not found:', DUMP);
  process.exit(1);
}

const raw = fs.readFileSync(DUMP, 'utf8');
const converted = convert(raw);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Header: clear tables in dependency-safe order
const clears = [
  'PRAGMA foreign_keys = OFF;',
  'DELETE FROM session_snapshots;',
  'DELETE FROM chat_messages;',
  'DELETE FROM live_visitors;',
  'DELETE FROM therapy_sessions;',
  'DELETE FROM payment_links;',
  'DELETE FROM clients;',
  'DELETE FROM consultations;',
  'DELETE FROM blocked_slots;',
  'DELETE FROM visitor_log;',
  "DELETE FROM settings WHERE setting_key IN ('admin_password','hours_windows','default_price_cents');",
].join('\n');

let allInserts = '';
for (const t of TABLES) {
  const block = extractInserts(converted, t);
  if (block) {
    allInserts += block + '\n';
    console.log(`  ${t}: ${(block.match(/\),\s*\(/g) || []).length + (block.includes('VALUES') ? 1 : 0)} row groups`);
  } else {
    console.log(`  ${t}: (no data)`);
  }
}

let smallInserts = '';
for (const t of TABLES) {
  if (t === 'session_snapshots') continue;
  const block = extractInserts(converted, t);
  if (block) smallInserts += block + '\n';
}

// Split session_snapshots — may be many INSERT statements in dump
const snapRe = /INSERT INTO `session_snapshots`[\s\S]*?;/gi;
const snapMatches = [...converted.matchAll(snapRe)].map(m => m[0]);

const header = `-- Generated ${new Date().toISOString()}\n${clears}\n`;
fs.writeFileSync(path.join(OUT_DIR, '00-clear-and-small.sql'), header + smallInserts);

if (snapMatches.length) {
  const prefix = 'INSERT INTO session_snapshots (id, vid, snapshot, created_at) VALUES\n';
  const rows = [];
  for (const snapSql of snapMatches) {
    const valStart = snapSql.indexOf('VALUES');
    const body = snapSql.slice(valStart + 6).replace(/;\s*$/, '');
    for (const line of body.split(/\n/)) {
      const l = line.trim();
      if (!l.startsWith('(')) continue;
      rows.push((l.endsWith(',') ? l.slice(0, -1) : l).replace(/;\s*$/, ''));
    }
  }

  const ROWS_PER_FILE = 80;
  let fileIdx = 1;
  let buf = [];
  for (let i = 0; i < rows.length; i++) {
    buf.push(`INSERT INTO session_snapshots (id, vid, snapshot, created_at) VALUES ${rows[i]};`);
    if (buf.length >= ROWS_PER_FILE || i === rows.length - 1) {
      const fname = `snapshots-${String(fileIdx).padStart(3, '0')}.sql`;
      fs.writeFileSync(path.join(OUT_DIR, fname), buf.join('\n') + '\n');
      if (fileIdx <= 3 || fileIdx % 200 === 0) console.log(`  wrote ${fname} (${buf.length} rows)`);
      fileIdx++;
      buf = [];
    }
  }
  console.log(`  session_snapshots total: ${rows.length} rows in ${fileIdx - 1} files`);
}

console.log('\nWrote import/*.sql — run:');
console.log('  wrangler d1 execute phobiafree-db --remote --file import/00-clear-and-small.sql');
console.log('  wrangler d1 execute phobiafree-db --remote --file import/snapshots-XX.sql  (each file)');
