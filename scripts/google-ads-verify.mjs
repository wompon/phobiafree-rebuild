/**
 * Quick structure check for campaign 24066888224.
 * Usage: node scripts/google-ads-verify.mjs
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const CAMPAIGN_ID = '24066888224';

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

async function gaql(query) {
  const h = {
    Authorization: `Bearer ${tok.access_token}`,
    'developer-token': prefs.developer_token,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers: h, body: JSON.stringify({ query }) },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 800));
  const rows = [];
  for (const c of (Array.isArray(data) ? data : [])) for (const r of (c.results || [])) rows.push(r);
  return rows;
}

const camp = await gaql(`
  SELECT campaign.name, campaign.status, campaign.start_date, campaign.end_date,
    campaign_budget.amount_micros
  FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}
`);
const c = camp[0];
console.log('CAMPAIGN:', c.campaign.name, '| status:', c.campaign.status,
  '| start:', c.campaign.startDate, '| end:', c.campaign.endDate || '(none)',
  '| budget: $' + Number(c.campaignBudget.amountMicros) / 1e6 + '/day');

const kws = await gaql(`
  SELECT ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.status
  FROM ad_group_criterion
  WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
`);
const byGroup = {};
for (const r of kws) byGroup[r.adGroup.name] = (byGroup[r.adGroup.name] || 0) + 1;
console.log('KEYWORDS:', kws.length, 'total', byGroup);

const ads = await gaql(`
  SELECT ad_group.name, ad_group_ad.policy_summary.approval_status
  FROM ad_group_ad WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_ad.status != 'REMOVED'
`);
for (const r of ads) console.log('AD:', r.adGroup.name, '|', r.adGroupAd?.policySummary?.approvalStatus || '(pending review)');

const negs = await gaql(`
  SELECT campaign_criterion.criterion_id FROM campaign_criterion
  WHERE campaign.id = ${CAMPAIGN_ID} AND campaign_criterion.negative = TRUE
    AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.status != 'REMOVED'
`);
console.log('NEGATIVES:', negs.length);
