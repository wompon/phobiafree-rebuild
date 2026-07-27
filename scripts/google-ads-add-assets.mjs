/**
 * Add sitelink + callout assets to campaign 24066888224.
 * Usage: node scripts/google-ads-add-assets.mjs
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const CAMPAIGN_ID = '24066888224';
const BASE = 'https://phobiafree.life/fear-of-flying';

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

// Query params keep each sitelink URL unique (Google requires distinct landing pages).
const SITELINKS = [
  {
    linkText: 'How It Works',
    description1: '3 simple steps to freedom',
    description2: 'One peaceful Zoom session',
    url: `${BASE}?sl=how#how`,
  },
  {
    linkText: 'FAQ',
    description1: 'Will I be hypnotized?',
    description2: 'Answers to common questions',
    url: `${BASE}?sl=faq#faq`,
  },
  {
    linkText: 'Pricing',
    description1: 'Clear options, no surprises',
    description2: 'Pay after satisfaction',
    url: `${BASE}?sl=pricing#pricing`,
  },
  {
    linkText: 'Book Free Consultation',
    description1: '30 minutes, no obligation',
    description2: 'Complimentary via Zoom',
    url: `${BASE}?sl=book&modal=1`,
  },
];

const CALLOUTS = [
  'Pay Only If Satisfied',
  'One-Session Plan',
  'No Trance Required',
  'Free 30-Min Consult',
  'All 50 States via Zoom',
  '12+ Years Experience',
];

for (const s of SITELINKS) {
  if (s.linkText.length > 25) throw new Error(`Sitelink text >25: ${s.linkText}`);
  if (s.description1.length > 35 || s.description2.length > 35) throw new Error(`Sitelink desc >35: ${s.linkText}`);
}
for (const c of CALLOUTS) {
  if (c.length > 25) throw new Error(`Callout >25: ${c}`);
}

console.log('Creating sitelink assets...');
const slResults = await mutate('assets', SITELINKS.map((s) => ({
  create: {
    finalUrls: [s.url],
    sitelinkAsset: {
      linkText: s.linkText,
      description1: s.description1,
      description2: s.description2,
    },
  },
})));

console.log('Creating callout assets...');
const coResults = await mutate('assets', CALLOUTS.map((text) => ({
  create: { calloutAsset: { calloutText: text } },
})));

console.log('Linking assets to campaign...');
const campaignRes = `customers/${customerId}/campaigns/${CAMPAIGN_ID}`;
await mutate('campaignAssets', [
  ...slResults.map((r) => ({
    create: { campaign: campaignRes, asset: r.resourceName, fieldType: 'SITELINK' },
  })),
  ...coResults.map((r) => ({
    create: { campaign: campaignRes, asset: r.resourceName, fieldType: 'CALLOUT' },
  })),
]);

console.log(`DONE — ${SITELINKS.length} sitelinks + ${CALLOUTS.length} callouts attached to the campaign.`);
