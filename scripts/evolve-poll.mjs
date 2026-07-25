/**
 * Local Thoughts runner — polls D1 for queued evolve ideas and runs Cursor Agent locally.
 * Use this when you don't have a GitHub repo for Cloud Agents yet.
 *
 *   set CURSOR_API_KEY=...
 *   node scripts/evolve-poll.mjs
 *
 * Or put CURSOR_API_KEY in .dev.vars (same folder) — this script reads it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const INTERVAL_MS = Number(process.env.EVOLVE_POLL_MS || 8000);

function loadKey() {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY.trim();
  const p = join(root, '.dev.vars');
  if (!existsSync(p)) return '';
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^CURSOR_API_KEY\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function d1(sql) {
  const file = join(tmpdir(), `evolve-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(file, sql, 'utf8');
  try {
    const out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'phobiafree-db', '--remote', '-c', 'wrangler-site.jsonc', `--file=${file}`, '--json'],
      { encoding: 'utf8', cwd: root, shell: true },
    );
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) {
      for (let i = parsed.length - 1; i >= 0; i--) {
        if (parsed[i]?.results) return parsed[i].results;
      }
      return [];
    }
    return parsed?.results || [];
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function sqlEscape(s) {
  return String(s ?? '').replace(/'/g, "''");
}

async function claimOne() {
  const rows = d1(`SELECT id, body, agent_prompt, domain FROM evolve_ideas WHERE status = 'queued' ORDER BY id ASC LIMIT 1;`);
  const idea = rows[0];
  if (!idea) return null;
  d1(`UPDATE evolve_ideas SET status = 'doing', run_note = 'Local agent runner claimed', updated_at = datetime('now') WHERE id = ${Number(idea.id)} AND status = 'queued';`);
  return idea;
}

async function runIdea(idea, Agent) {
  const prompt = idea.agent_prompt || idea.body;
  console.log(`\n→ Running thought #${idea.id} (${idea.domain || 'general'})`);
  const result = await Agent.prompt(prompt, {
    apiKey: loadKey(),
    model: { id: process.env.CURSOR_AGENT_MODEL || 'composer-2.5' },
    local: { cwd: root },
  });
  const summary = String(result?.result || result?.status || 'finished').slice(0, 800);
  const status = result?.status === 'error' ? 'blocked' : 'done';
  d1(`UPDATE evolve_ideas SET status = '${status}', result = '${sqlEscape(summary)}', run_note = 'Local agent ${status}', updated_at = datetime('now') WHERE id = ${Number(idea.id)};`);
  console.log(`← #${idea.id} ${status}`);
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error('Missing CURSOR_API_KEY (env or .dev.vars)');
    process.exit(1);
  }

  let Agent;
  try {
    ({ Agent } = await import('@cursor/sdk'));
  } catch (e) {
    console.error('Install the SDK first: npm install @cursor/sdk');
    process.exit(1);
  }

  console.log('Evolve poller watching queued thoughts… Ctrl+C to stop');
  for (;;) {
    try {
      const idea = await claimOne();
      if (idea) await runIdea(idea, Agent);
    } catch (e) {
      console.error('poll error', e?.message || e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
