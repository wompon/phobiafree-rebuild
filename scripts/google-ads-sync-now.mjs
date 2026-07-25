/**
 * One-shot: pull Google Ads into remote D1 with current ark_prefs.
 * Usage: node scripts/google-ads-sync-now.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const API = 'v22';
const cwd = process.cwd();

function sqlEscape(s) {
  return String(s ?? '').replace(/'/g, "''");
}

function microsToMoney(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (n / 1e6).toFixed(2);
}

function d1Sql(sql) {
  const file = join(tmpdir(), `ads-sync-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(file, sql, 'utf8');
  try {
    const out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'phobiafree-db', '--remote', '-c', 'wrangler-site.jsonc', `--file=${file}`, '--json'],
      { encoding: 'utf8', cwd, shell: true },
    );
    return JSON.parse(out);
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function resultsOf(parsed) {
  if (Array.isArray(parsed)) {
    // wrangler --json can return an array of statement results
    for (let i = parsed.length - 1; i >= 0; i--) {
      if (parsed[i]?.results) return parsed[i].results;
    }
    return [];
  }
  return parsed?.results || [];
}

async function searchStream({ accessToken, developerToken, customerId, loginCustomerId, query }) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
  );
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 300)); }
  if (!res.ok) {
    const msg = data?.error?.details?.[0]?.errors?.[0]?.message || data?.error?.message || text.slice(0, 300);
    throw new Error(msg);
  }
  const rows = [];
  for (const chunk of (Array.isArray(data) ? data : [])) {
    for (const row of (chunk.results || [])) rows.push(row);
  }
  return rows;
}

const REPORTS = [
  {
    type: 'search_terms',
    query: `
      SELECT search_term_view.search_term, campaign.name, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
      LIMIT 800
    `,
    map: (r) => ({
      'Search term': r.searchTermView?.searchTerm || '',
      Campaign: r.campaign?.name || '',
      'Ad group': r.adGroup?.name || '',
      'Impr.': r.metrics?.impressions ?? '',
      Clicks: r.metrics?.clicks ?? '',
      CTR: r.metrics?.ctr != null ? `${(Number(r.metrics.ctr) * 100).toFixed(2)}%` : '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '',
    }),
  },
  {
    type: 'campaigns',
    query: `
      SELECT campaign.id, campaign.name, campaign.status,
        metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED'
      ORDER BY metrics.impressions DESC
      LIMIT 200
    `,
    map: (r) => ({
      Campaign: r.campaign?.name || '',
      Status: r.campaign?.status || '',
      'Impr.': r.metrics?.impressions ?? '0',
      Clicks: r.metrics?.clicks ?? '0',
      CTR: r.metrics?.ctr != null ? `${(Number(r.metrics.ctr) * 100).toFixed(2)}%` : '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '0',
    }),
  },
  {
    type: 'keywords',
    query: `
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        campaign.name, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions
      FROM keyword_view
      WHERE segments.date DURING LAST_30_DAYS
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.impressions DESC
      LIMIT 500
    `,
    map: (r) => ({
      Keyword: r.adGroupCriterion?.keyword?.text || '',
      'Match type': r.adGroupCriterion?.keyword?.matchType || '',
      Campaign: r.campaign?.name || '',
      'Ad group': r.adGroup?.name || '',
      'Impr.': r.metrics?.impressions ?? '',
      Clicks: r.metrics?.clicks ?? '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '',
    }),
  },
];

const prefsParsed = d1Sql(`SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';`);
const prefsRows = resultsOf(prefsParsed);
const prefs = Object.fromEntries(
  prefsRows.map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]),
);

const customerId = String(prefs.customer_id || '').replace(/\D/g, '');
const loginCustomerId = String(prefs.login_customer_id || '').replace(/\D/g, '');
console.log('Using customer', customerId, 'login', loginCustomerId || '(none)');
if (customerId !== '7050636542') {
  console.warn('WARNING: expected customer 7050636542');
}

const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: prefs.client_id,
    client_secret: prefs.client_secret,
    refresh_token: prefs.refresh_token,
    grant_type: 'refresh_token',
  }),
}).then((r) => r.json());
if (!tok.access_token) throw new Error(JSON.stringify(tok));

d1Sql('DELETE FROM ads_rows; DELETE FROM ads_imports;');

for (const report of REPORTS) {
  const apiRows = await searchStream({
    accessToken: tok.access_token,
    developerToken: prefs.developer_token,
    customerId,
    loginCustomerId,
    query: report.query,
  });
  const mapped = apiRows
    .map(report.map)
    .filter((row) => Object.values(row).some((v) => v !== '' && v != null));
  console.log(report.type, mapped.length, mapped[0] ? Object.values(mapped[0])[0] : '');

  d1Sql(
    `INSERT INTO ads_imports (report_type, filename, row_count, created_at) VALUES ('${report.type}', 'google-ads-api:${report.type}', ${mapped.length}, datetime('now'));`,
  );
  const idRow = resultsOf(
    d1Sql(`SELECT id FROM ads_imports WHERE report_type='${report.type}' ORDER BY id DESC LIMIT 1;`),
  )[0];
  const importId = idRow?.id;
  if (!importId) throw new Error(`No import id for ${report.type}`);

  const chunkSize = 25;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const slice = mapped.slice(i, i + chunkSize);
    const sql = slice
      .map(
        (row) =>
          `INSERT INTO ads_rows (import_id, report_type, data_json, created_at) VALUES (${importId}, '${report.type}', '${sqlEscape(JSON.stringify(row))}', datetime('now'));`,
      )
      .join('\n');
    d1Sql(sql);
  }
}

const when = new Date().toISOString();
d1Sql(`UPDATE ark_prefs SET value='${sqlEscape(when)}', updated_at=datetime('now') WHERE key='google_ads_last_sync'; UPDATE ark_prefs SET value='', updated_at=datetime('now') WHERE key='google_ads_last_error';`);

const check = resultsOf(d1Sql('SELECT report_type, COUNT(*) AS n FROM ads_rows GROUP BY report_type;'));
console.log('DB now:', check);
console.log('Done', when);
