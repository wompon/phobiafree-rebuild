/**
 * Convert every PHRASE keyword in the campaign to EXACT.
 * Google doesn't allow editing matchType in place, so for each phrase keyword
 * we create an EXACT twin (same text, status, bid) and remove the phrase one.
 * Usage: node scripts/google-ads-to-exact.mjs [--dry]
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const CAMPAIGN_ID = '24066888224';
const DRY = process.argv.includes('--dry');

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
async function mutate(resource, operations) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/${resource}:mutate`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ operations }) },
  );
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${resource}: ${text.slice(0, 500)}`); }
  if (!res.ok) throw new Error(`${resource} failed: ${JSON.stringify(data?.error?.details || data?.error?.message || data).slice(0, 1500)}`);
  return data.results || [];
}

// All active (non-negative) keywords in the campaign, with match type + bid.
const rows = await gaql(`
  SELECT
    ad_group.resource_name, ad_group.name,
    ad_group_criterion.resource_name,
    ad_group_criterion.status,
    ad_group_criterion.keyword.text,
    ad_group_criterion.keyword.match_type,
    ad_group_criterion.cpc_bid_micros
  FROM ad_group_criterion
  WHERE campaign.id = ${CAMPAIGN_ID}
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND ad_group_criterion.status != 'REMOVED'
`);

const byGroup = {};
for (const r of rows) {
  const g = r.adGroup.name;
  byGroup[g] ??= { res: r.adGroup.resourceName, phrase: [], exact: new Set() };
  const kw = {
    res: r.adGroupCriterion.resourceName,
    text: r.adGroupCriterion.keyword.text,
    status: r.adGroupCriterion.status,
    bid: r.adGroupCriterion.cpcBidMicros,
  };
  const mt = r.adGroupCriterion.keyword.matchType;
  if (mt === 'PHRASE') byGroup[g].phrase.push(kw);
  else if (mt === 'EXACT') byGroup[g].exact.add(kw.text.toLowerCase());
}

let totalCreate = 0, totalRemove = 0;
for (const [name, g] of Object.entries(byGroup)) {
  if (!g.phrase.length) { console.log(`${name}: already exact (${g.exact.size} kws)`); continue; }
  console.log(`${name}: converting ${g.phrase.length} phrase → exact`);
  const creates = g.phrase
    .filter((kw) => !g.exact.has(kw.text.toLowerCase()))
    .map((kw) => ({
      create: {
        adGroup: g.res,
        status: kw.status === 'PAUSED' ? 'PAUSED' : 'ENABLED',
        keyword: { text: kw.text, matchType: 'EXACT' },
        ...(kw.bid ? { cpcBidMicros: String(kw.bid) } : {}),
      },
      exemptPolicyViolationKeys: [
        { policyName: 'HEALTH_IN_PERSONALIZED_ADS', violatingText: kw.text },
      ],
    }));
  const removes = g.phrase.map((kw) => ({ remove: kw.res }));

  if (DRY) {
    for (const c of creates) console.log(`  +EXACT  ${c.create.keyword.text}`);
    for (const kw of g.phrase) console.log(`  -PHRASE ${kw.text}`);
  } else {
    if (creates.length) await mutate('adGroupCriteria', creates);
    await mutate('adGroupCriteria', removes);
  }
  totalCreate += creates.length;
  totalRemove += removes.length;
}

console.log('');
console.log(`${DRY ? 'DRY RUN — would create' : 'Created'} ${totalCreate} exact keywords, ${DRY ? 'would remove' : 'removed'} ${totalRemove} phrase keywords.`);
