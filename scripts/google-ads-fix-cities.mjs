/**
 * Finish the Cities ad group: add keywords with policy exemption requests + the RSA.
 * Usage: node scripts/google-ads-fix-cities.mjs
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const FINAL_URL = 'https://phobiafree.life/fear-of-flying';
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

function resultsOf(parsed) {
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      if (parsed[i]?.results) return parsed[i].results;
    }
    return [];
  }
  return parsed?.results || [];
}

const prefsRows = resultsOf(d1Sql(`SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';`));
const prefs = Object.fromEntries(prefsRows.map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]));
const customerId = String(prefs.customer_id || '').replace(/\D/g, '');
const loginCustomerId = String(prefs.login_customer_id || '').replace(/\D/g, '');

const keeperRows = resultsOf(d1Sql(`SELECT keyword FROM semrush_keywords WHERE keep = 1 ORDER BY volume DESC;`));
const keepers = [...new Set(keeperRows.map((r) => String(r.keyword || '').trim().toLowerCase()).filter(Boolean))];
const CITY_RE = /(nyc|new york|scarsdale|chappaqua|winnetka|westfield|rhinebeck|ho-ho-kus|saddle river|naperville|evanston|armonk|agoura hills|beverly hills|san diego|porter ranch|del mar)/i;
const cityKws = keepers.filter((kw) => CITY_RE.test(kw));
console.log('City keywords:', cityKws.length);

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
  for (const chunk of (Array.isArray(data) ? data : [])) {
    for (const row of (chunk.results || [])) rows.push(row);
  }
  return rows;
}

async function mutate(resource, body) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/${resource}:mutate`,
    { method: 'POST', headers: headers(), body: JSON.stringify(body) },
  );
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${resource}: ${text.slice(0, 500)}`); }
  if (!res.ok) throw new Error(`${resource} failed: ${JSON.stringify(data?.error?.details || data?.error?.message || data).slice(0, 1500)}`);
  return data.results || [];
}

const agRows = await gaql(`
  SELECT ad_group.resource_name, ad_group.name
  FROM ad_group
  WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group.name = 'Cities'
`);
const adGroupRes = agRows[0]?.adGroup?.resourceName;
if (!adGroupRes) throw new Error('Cities ad group not found');
console.log('Cities ad group:', adGroupRes);

const existing = await gaql(`
  SELECT ad_group_criterion.keyword.text
  FROM ad_group_criterion
  WHERE ad_group.resource_name = '${adGroupRes}' AND ad_group_criterion.type = 'KEYWORD'
`);
const have = new Set(existing.map((r) => String(r.adGroupCriterion?.keyword?.text || '').toLowerCase()));
const toAdd = cityKws.filter((kw) => !have.has(kw));
console.log('Keywords to add:', toAdd.length);

if (toAdd.length) {
  await mutate('adGroupCriteria', {
    operations: toAdd.map((text) => ({
      create: {
        adGroup: adGroupRes,
        status: 'ENABLED',
        keyword: { text, matchType: 'EXACT' },
      },
      exemptPolicyViolationKeys: [
        { policyName: 'HEALTH_IN_PERSONALIZED_ADS', violatingText: text },
      ],
    })),
  });
  console.log('Keywords added with policy exemption requests.');
}

const ads = await gaql(`
  SELECT ad_group_ad.ad.id
  FROM ad_group_ad
  WHERE ad_group.resource_name = '${adGroupRes}' AND ad_group_ad.status != 'REMOVED'
`);
if (!ads.length) {
  const HEADLINES = [
    'Online, Anywhere in the US', 'Flying Phobia Help via Zoom',
    'Fear of Flying? Get Help Now', 'Certified Hypnotherapist', 'No Trance Required',
    'Zoom Sessions, US Wide', 'Fly Calm Again', 'Overcome Fear of Flying', 'Book Your Session Today',
  ];
  const DESCRIPTIONS = [
    'Work 1-on-1 with a certified clinical hypnotherapist over Zoom. No trance required.',
    'Personalized online sessions that get to the root of your fear of flying. All 50 states.',
    'Stop dreading flights. Calm, confident flying is closer than you think. Book on Zoom.',
  ];
  await mutate('adGroupAds', {
    operations: [{
      create: {
        adGroup: adGroupRes,
        status: 'ENABLED',
        ad: {
          finalUrls: [FINAL_URL],
          responsiveSearchAd: {
            headlines: HEADLINES.map((text) => ({ text })),
            descriptions: DESCRIPTIONS.map((text) => ({ text })),
          },
        },
      },
    }],
  });
  console.log('RSA created for Cities.');
} else {
  console.log('Cities already has an ad.');
}
console.log('DONE');
