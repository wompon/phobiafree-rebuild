/**
 * Replace RSAs in campaign 24066888224 with copy matched to the landing page:
 * one-session plan, satisfaction guarantee, free consultation.
 * Usage: node scripts/google-ads-refresh-ads.mjs
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

const COMMON_HEADLINES = [
  'Fear of Flying? Get Help Now',
  'Certified Hypnotherapist',
  'No Trance, No Exposure',
  'One Zoom Session Is the Plan',
  'Not Satisfied? You Don\u2019t Pay',
  'Free 30-Minute Consultation',
  'Fly Calm, Anywhere in the US',
  'Overcome Fear of Flying',
];
const COMMON_DESCRIPTIONS = [
  'One peaceful Zoom session with a certified clinical hypnotherapist. No trance required.',
  'If you\u2019re not completely satisfied after your first session, you don\u2019t pay. Guaranteed.',
  'Start with a free 30-minute consultation. Serving all 50 states over secure Zoom.',
  'No reliving trauma, no long-term therapy. Feel the shift in one session.',
];
const GROUP_HEADLINES = {
  'Hypnosis / Hypnotherapy': ['Hypnosis for Fear of Flying', 'Clinical Hypnotherapy Online'],
  'Therapy / Treatment': ['Fear of Flying Therapy Online', 'Beyond Traditional Therapy'],
  'How-to / Overcome': ['How to Get Over Flying Fear', 'Stop White-Knuckle Flights'],
  Cities: ['Online, Anywhere in the US', 'Flying Phobia Help via Zoom'],
};

for (const h of COMMON_HEADLINES.concat(...Object.values(GROUP_HEADLINES))) {
  if (h.length > 30) throw new Error(`Headline >30: (${h.length}) ${h}`);
}
for (const d of COMMON_DESCRIPTIONS) {
  if (d.length > 90) throw new Error(`Description >90: (${d.length}) ${d}`);
}

const ags = await gaql(`
  SELECT ad_group.resource_name, ad_group.name
  FROM ad_group WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group.status != 'REMOVED'
`);

for (const row of ags) {
  const agRes = row.adGroup.resourceName;
  const name = row.adGroup.name;
  const groupHls = GROUP_HEADLINES[name];
  if (!groupHls) { console.log('Skip unknown ad group:', name); continue; }

  const oldAds = await gaql(`
    SELECT ad_group_ad.resource_name FROM ad_group_ad
    WHERE ad_group.resource_name = '${agRes}' AND ad_group_ad.status != 'REMOVED'
  `);

  console.log(`${name}: creating new RSA...`);
  await mutate('adGroupAds', {
    operations: [{
      create: {
        adGroup: agRes,
        status: 'ENABLED',
        ad: {
          finalUrls: [FINAL_URL],
          responsiveSearchAd: {
            headlines: [...groupHls, ...COMMON_HEADLINES].slice(0, 15).map((text) => ({ text })),
            descriptions: COMMON_DESCRIPTIONS.map((text) => ({ text })),
          },
        },
      },
    }],
  });

  if (oldAds.length) {
    await mutate('adGroupAds', {
      operations: oldAds.map((r) => ({ remove: r.adGroupAd.resourceName })),
    });
    console.log(`${name}: removed ${oldAds.length} old ad(s).`);
  }
}
console.log('DONE — all ad groups now run the landing-page-matched RSA.');
