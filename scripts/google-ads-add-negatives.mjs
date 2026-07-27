/**
 * Expand campaign-level negative keywords on campaign 24066888224.
 * Skips any negative already present.
 * Usage: node scripts/google-ads-add-negatives.mjs
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

const NEW_NEGATIVES = [
  // Hypnotherapist-peer traffic (they search hypnosis terms constantly, never buy)
  'script', 'scripts', 'training', 'certification', 'become a hypnotherapist',
  // DIY / content formats (plural + singular — negatives do NOT match variants)
  'podcast', 'podcasts', 'audiobook', 'audio', 'mp3', 'spotify', 'cd',
  'workbook', 'worksheet', 'worksheets', 'ebook', 'kindle', 'amazon',
  'guide', 'article', 'articles', 'videos', 'story', 'stories',
  'support group', 'exercises', 'techniques', 'breathing',
  // Meds round 2
  'medications', 'pill', 'propranolol', 'beta blocker', 'beta blockers',
  'klonopin', 'lorazepam', 'ambien', 'ssri', 'antidepressant', 'antidepressants',
  'cbd', 'gummies', 'weed', 'marijuana', 'supplement', 'supplements', 'vitamins',
  // Research round 2
  'cause', 'symptom', 'research', 'study', 'studies', 'stats', 'facts',
  'psychology', 'how common', 'percentage', 'wiki',
  // Wrong audience round 2
  'kid', 'children', 'teen', 'teenager', 'baby', 'salary', 'hiring',
  'insurance', 'medicare', 'medicaid', 'spanish', 'espanol',
  // Entertainment round 2
  'tiktok', 'instagram', 'netflix', 'documentary', 'gif', 'cartoon',
  'joke', 'jokes', 'quote', 'songs', 'movies', 'game', 'games',
  // Tech-solution seekers (he sells human sessions, not software)
  'vr', 'virtual reality', 'simulator', 'flight simulator', 'ai',
  // Competitor programs + more airlines
  'soar', 'tom bunn', 'dial', 'fearless flyer',
  'alaska airlines', 'spirit airlines', 'frontier', 'emirates', 'qantas',
  'lufthansa', 'klm', 'air france', 'air canada', 'turkish airlines',
  // Local-intent leftovers
  'near me', 'cheap',
];

const existing = await gaql(`
  SELECT campaign_criterion.keyword.text
  FROM campaign_criterion
  WHERE campaign.id = ${CAMPAIGN_ID}
    AND campaign_criterion.negative = TRUE
    AND campaign_criterion.type = 'KEYWORD'
    AND campaign_criterion.status != 'REMOVED'
`);
const have = new Set(existing.map((r) => String(r.campaignCriterion?.keyword?.text || '').toLowerCase()));
console.log('Existing negatives:', have.size);

const toAdd = [...new Set(NEW_NEGATIVES.map((s) => s.toLowerCase()))].filter((s) => !have.has(s));
console.log('New negatives to add:', toAdd.length);

if (toAdd.length) {
  await mutate('campaignCriteria', toAdd.map((text) => ({
    create: {
      campaign: `customers/${customerId}/campaigns/${CAMPAIGN_ID}`,
      negative: true,
      keyword: { text, matchType: 'BROAD' },
    },
  })));
}

const after = await gaql(`
  SELECT campaign_criterion.criterion_id
  FROM campaign_criterion
  WHERE campaign.id = ${CAMPAIGN_ID}
    AND campaign_criterion.negative = TRUE
    AND campaign_criterion.type = 'KEYWORD'
    AND campaign_criterion.status != 'REMOVED'
`);
console.log('DONE — total campaign negatives now:', after.length);
