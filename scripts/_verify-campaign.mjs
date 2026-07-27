import { execSync } from 'node:child_process';
const API = 'v22';
const cwd = process.cwd();

function d1Sql(sql) {
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
const prefs = Object.fromEntries(resultsOf(d1Sql(`SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';`)).map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]));
const customerId = String(prefs.customer_id).replace(/\D/g, '');
const loginCustomerId = String(prefs.login_customer_id || '').replace(/\D/g, '');
const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: prefs.client_id, client_secret: prefs.client_secret, refresh_token: prefs.refresh_token, grant_type: 'refresh_token' }),
}).then((r) => r.json());
async function gaql(query) {
  const h = { Authorization: `Bearer ${tok.access_token}`, 'developer-token': prefs.developer_token, 'Content-Type': 'application/json' };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  const res = await fetch(`https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`, { method: 'POST', headers: h, body: JSON.stringify({ query }) });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 500));
  const rows = [];
  for (const c of (Array.isArray(data) ? data : [])) for (const r of (c.results || [])) rows.push(r);
  return rows;
}

const camp = await gaql(`SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.id = 24066888224`);
console.log('CAMPAIGN:', camp[0]?.campaign?.name, camp[0]?.campaign?.status, 'budget $' + (Number(camp[0]?.campaignBudget?.amountMicros) / 1e6));

const ags = await gaql(`SELECT ad_group.name, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = 24066888224`);
for (const r of ags) console.log('AD GROUP:', r.adGroup.name, 'cap $' + (Number(r.adGroup.cpcBidMicros) / 1e6));

const kws = await gaql(`SELECT ad_group.name, ad_group_criterion.criterion_id FROM ad_group_criterion WHERE campaign.id = 24066888224 AND ad_group_criterion.type = 'KEYWORD'`);
const counts = {};
for (const r of kws) counts[r.adGroup.name] = (counts[r.adGroup.name] || 0) + 1;
console.log('KEYWORDS PER GROUP:', counts);

const ads = await gaql(`SELECT ad_group.name, ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status FROM ad_group_ad WHERE campaign.id = 24066888224`);
for (const r of ads) console.log('AD:', r.adGroup.name, r.adGroupAd?.policySummary?.approvalStatus || '(pending)');

const negs = await gaql(`SELECT campaign_criterion.criterion_id FROM campaign_criterion WHERE campaign.id = 24066888224 AND campaign_criterion.negative = TRUE`);
console.log('CAMPAIGN NEGATIVES:', negs.length);
