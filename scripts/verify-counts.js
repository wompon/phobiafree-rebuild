/**
 * Compare expected row counts from MySQL dump vs D1 remote.
 * Run: node scripts/verify-counts.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DUMP =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || '',
    'Documents/phobiafree.life/public_html/phobiafree.life/phobiafreelife.sql'
  );

const TABLES = [
  'visitor_log',
  'session_snapshots',
  'blocked_slots',
  'clients',
  'consultations',
  'payment_links',
  'therapy_sessions',
  'settings',
  'chat_messages',
];

function countRowsInDump(sql, table) {
  const re = new RegExp(`INSERT INTO \`${table}\`[\\s\\S]*?;`, 'gi');
  const m = sql.match(re);
  if (!m) return 0;
  let total = 0;
  for (const block of m) {
    const valIdx = block.indexOf('VALUES');
    if (valIdx < 0) continue;
    const body = block.slice(valIdx);
    total += (body.match(/\),\s*\(/g) || []).length + 1;
  }
  return total;
}

function d1Count(table) {
  const out = execSync(
    `wrangler d1 execute phobiafree-db --remote --command "SELECT COUNT(*) AS c FROM ${table}"`,
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
  );
  const m = out.match(/"c":\s*(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

const sql = fs.readFileSync(DUMP, 'utf8');
console.log('Table                  MySQL dump    D1 remote');
console.log('─────────────────────────────────────────────');
let ok = true;
for (const t of TABLES) {
  const expected = countRowsInDump(sql, t);
  let actual = -1;
  try {
    actual = d1Count(t);
  } catch (e) {
    actual = -1;
  }
  const match = expected === actual ? '✓' : '✗';
  if (expected !== actual) ok = false;
  console.log(
    `${t.padEnd(22)} ${String(expected).padStart(8)}    ${String(actual).padStart(8)}  ${match}`
  );
}
process.exit(ok ? 0 : 1);
