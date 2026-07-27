/**
 * Set the daily budget for campaign 24066888224.
 * Usage: node scripts/google-ads-set-budget.mjs [dollars]
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const CAMPAIGN_ID = '24066888224';
const dollars = Number(process.argv[2] || 50);
if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 500) throw new Error('Bad amount: ' + process.argv[2]);

function d1Sql(sql) {
  if (sql.includes('"')) throw new Error('Use single quotes in SQL');
  const out = execSync(
    `npx wrangler d1 execute phobiafree-db --remote -c wrangler-site.jsonc --json --command "${sql}"`,
    { encoding: 'utf8', cwd },
  );
  const start = out.search(/\[\s*[{\]]/);
  return JSON.parse(start >= 0 ? out.slice(start) : out);
}
function resultsOf(p) {
  if (Array.isArray(p)) { for (let i = p.length - 1; i >= 0; i--) if (p[i]?.results) return p[i].results; return []; }
  return p?.results || [];
}

const prefs = Object.fromEntries(
  resultsOf(d1Sql(`SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';`))
    .map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]),
);
const customerId = String(prefs.customer_id).replace(/\D/g, '');
const loginCustomerId = String(prefs.login_customer_id || '').replace(/\D/g, '');

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
if (!tok.access_token) throw new Error('OAuth: ' + JSON.stringify(tok));

function headers() {
  const h = {
    Authorization: `Bearer ${tok.access_token}`,
    'developer-token': prefs.developer_token,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}
async function gaql(query) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ query }) },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 800));
  const rows = [];
  for (const c of (Array.isArray(data) ? data : [])) for (const r of (c.results || [])) rows.push(r);
  return rows;
}

const rows = await gaql(`
  SELECT campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros
  FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}
`);
const budgetRes = rows[0]?.campaignBudget?.resourceName;
if (!budgetRes) throw new Error('Budget not found');
console.log('Current:', rows[0].campaign.name, rows[0].campaign.status, '$' + Number(rows[0].campaignBudget.amountMicros) / 1e6 + '/day');

const res = await fetch(
  `https://googleads.googleapis.com/${API}/customers/${customerId}/campaignBudgets:mutate`,
  {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      operations: [{
        update: { resourceName: budgetRes, amountMicros: String(Math.round(dollars * 1e6)) },
        updateMask: 'amount_micros',
      }],
    }),
  },
);
const data = await res.json();
if (!res.ok) throw new Error(JSON.stringify(data?.error || data).slice(0, 800));
console.log(`DONE — daily budget set to $${dollars}/day.`);
