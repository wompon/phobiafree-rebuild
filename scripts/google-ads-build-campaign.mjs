/**
 * One-shot: build the "Fear of Flying — US" search campaign (PAUSED) via Google Ads API.
 * Creds come from ark_prefs in remote D1 (same as google-ads-sync-now.mjs).
 * Usage: node scripts/google-ads-build-campaign.mjs
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const FINAL_URL = 'https://phobiafree.life/fear-of-flying';
const CAMPAIGN_NAME = 'Fear of Flying — US';
const DAILY_BUDGET_MICROS = 28_000_000; // $28/day

function d1Sql(sql) {
  // --command (not --file): remote file imports return stats only, no SELECT rows.
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

// ---- Load creds + keepers -------------------------------------------------
const prefsRows = resultsOf(d1Sql(`SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';`));
const prefs = Object.fromEntries(prefsRows.map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]));
const customerId = String(prefs.customer_id || '').replace(/\D/g, '');
const loginCustomerId = String(prefs.login_customer_id || '').replace(/\D/g, '');
if (!customerId) throw new Error('No google_ads_customer_id in ark_prefs');
console.log('Customer', customerId, 'login', loginCustomerId || '(none)');

const keeperRows = resultsOf(d1Sql(`SELECT keyword FROM semrush_keywords WHERE keep = 1 ORDER BY volume DESC;`));
const keepers = [...new Set(keeperRows.map((r) => String(r.keyword || '').trim().toLowerCase()).filter(Boolean))];
console.log('Keepers:', keepers.length);
if (!keepers.length) throw new Error('No keepers in semrush_keywords');

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

async function mutate(resource, operations) {
  const headers = {
    Authorization: `Bearer ${tok.access_token}`,
    'developer-token': prefs.developer_token,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(
    `https://googleads.googleapis.com/${API}/customers/${customerId}/${resource}:mutate`,
    { method: 'POST', headers, body: JSON.stringify({ operations }) },
  );
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${resource}: ${text.slice(0, 500)}`); }
  if (!res.ok) {
    const details = JSON.stringify(data?.error?.details || data?.error?.message || data).slice(0, 1200);
    throw new Error(`${resource} failed: ${details}`);
  }
  return data.results || [];
}

// ---- Bucket keywords ------------------------------------------------------
const CITY_RE = /(nyc|new york|scarsdale|chappaqua|winnetka|westfield|rhinebeck|ho-ho-kus|saddle river|naperville|evanston|armonk|agoura hills|beverly hills|san diego|porter ranch|del mar)/i;
const HYP_RE = /(hypnosis|hypnotherapy|hypnotherapist)/i;
const THERAPY_RE = /(therapy|therapist|cure|clinic|counseling|coaching|remedy|treatment|help|extreme)/i;

const groups = {
  'Hypnosis / Hypnotherapy': { cpc: 2_400_000, match: 'PHRASE', kws: [] },
  'Therapy / Treatment': { cpc: 2_000_000, match: 'PHRASE', kws: [] },
  'How-to / Overcome': { cpc: 750_000, match: 'PHRASE', kws: [] },
  Cities: { cpc: 1_000_000, match: 'EXACT', kws: [] },
};
for (const kw of keepers) {
  if (CITY_RE.test(kw)) groups.Cities.kws.push(kw);
  else if (HYP_RE.test(kw)) groups['Hypnosis / Hypnotherapy'].kws.push(kw);
  else if (THERAPY_RE.test(kw)) groups['Therapy / Treatment'].kws.push(kw);
  else groups['How-to / Overcome'].kws.push(kw);
}
for (const [name, g] of Object.entries(groups)) console.log(name, g.kws.length);

const NEGATIVES = [
  'free', 'tips', 'tricks', 'reddit', 'quora', 'forum', 'blog', 'pdf', 'book', 'books',
  'app', 'apps', 'download', 'youtube', 'video', 'course', 'class', 'online course',
  'self help', 'diy', 'at home',
  'medication', 'meds', 'pills', 'drug', 'drugs', 'xanax', 'valium', 'diazepam', 'ativan',
  'benzo', 'prescription', 'dramamine', 'melatonin', 'alcohol', 'drink', 'drinking',
  'what is', 'definition', 'meaning', 'wikipedia', 'statistics', 'symptoms', 'causes',
  'why do', 'is it normal', 'quiz', 'test', 'dsm',
  'jobs', 'career', 'pilot', 'flight attendant', 'cabin crew', 'kids', 'child', 'toddler',
  'dog', 'cat', 'pet',
  'turbulence video', 'plane crash', 'crash video', 'dream', 'dreams', 'meme', 'funny',
  'quotes', 'song', 'lyrics', 'movie', 'film', 'insects', 'bugs', 'heights',
  'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'british airways',
  'ryanair', 'easyjet',
];

// ---- Ad copy (headlines <=30 chars, descriptions <=90 chars) ---------------
const COMMON_HEADLINES = [
  'Fear of Flying? Get Help Now',
  'Certified Hypnotherapist',
  'No Trance Required',
  'Zoom Sessions, US Wide',
  'Fly Calm Again',
  'Overcome Fear of Flying',
  'Book Your Session Today',
];
const COMMON_DESCRIPTIONS = [
  'Work 1-on-1 with a certified clinical hypnotherapist over Zoom. No trance required.',
  'Personalized online sessions that get to the root of your fear of flying. All 50 states.',
  'Stop dreading flights. Calm, confident flying is closer than you think. Book on Zoom.',
];
const GROUP_HEADLINES = {
  'Hypnosis / Hypnotherapy': ['Hypnosis for Fear of Flying', 'Clinical Hypnotherapy Online'],
  'Therapy / Treatment': ['Fear of Flying Therapy Online', 'Proven, Personalized Help'],
  'How-to / Overcome': ['How to Get Over Flying Fear', 'Stop White-Knuckle Flights'],
  Cities: ['Online, Anywhere in the US', 'Flying Phobia Help via Zoom'],
};

for (const h of COMMON_HEADLINES.concat(...Object.values(GROUP_HEADLINES))) {
  if (h.length > 30) throw new Error(`Headline >30 chars: ${h}`);
}
for (const d of COMMON_DESCRIPTIONS) {
  if (d.length > 90) throw new Error(`Description >90 chars: ${d}`);
}

// ---- Build ----------------------------------------------------------------
const stamp = new Date().toISOString().slice(0, 10);

console.log('Creating budget...');
const [budget] = await mutate('campaignBudgets', [{
  create: {
    name: `FoF US daily ${stamp}`,
    amountMicros: String(DAILY_BUDGET_MICROS),
    deliveryMethod: 'STANDARD',
    explicitlyShared: false,
  },
}]);
console.log('Budget:', budget.resourceName);

console.log('Creating campaign (PAUSED)...');
const campaignCreate = {
  name: CAMPAIGN_NAME,
  status: 'PAUSED',
  advertisingChannelType: 'SEARCH',
  manualCpc: {},
  campaignBudget: budget.resourceName,
  networkSettings: {
    targetGoogleSearch: true,
    targetSearchNetwork: false,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  },
  containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
};
let campaign;
try {
  [campaign] = await mutate('campaigns', [{ create: campaignCreate }]);
} catch (e) {
  if (/containsEuPoliticalAdvertising|contains_eu_political_advertising/i.test(String(e.message))) {
    delete campaignCreate.containsEuPoliticalAdvertising;
    [campaign] = await mutate('campaigns', [{ create: campaignCreate }]);
  } else {
    throw e;
  }
}
console.log('Campaign:', campaign.resourceName);

console.log('Adding geo (US) + language (English) + negatives...');
const campaignCriteriaOps = [
  { create: { campaign: campaign.resourceName, location: { geoTargetConstant: 'geoTargetConstants/2840' } } },
  { create: { campaign: campaign.resourceName, language: { languageConstant: 'languageConstants/1000' } } },
  ...NEGATIVES.map((text) => ({
    create: {
      campaign: campaign.resourceName,
      negative: true,
      keyword: { text, matchType: 'BROAD' },
    },
  })),
];
await mutate('campaignCriteria', campaignCriteriaOps);
console.log('Campaign criteria added:', campaignCriteriaOps.length);

for (const [name, g] of Object.entries(groups)) {
  if (!g.kws.length) { console.log(`Skip empty ad group: ${name}`); continue; }
  console.log(`Creating ad group: ${name} (${g.kws.length} kws, cap $${g.cpc / 1e6})`);
  const [adGroup] = await mutate('adGroups', [{
    create: {
      name,
      campaign: campaign.resourceName,
      status: 'ENABLED',
      type: 'SEARCH_STANDARD',
      cpcBidMicros: String(g.cpc),
    },
  }]);

  await mutate('adGroupCriteria', g.kws.map((text) => ({
    create: {
      adGroup: adGroup.resourceName,
      status: 'ENABLED',
      keyword: { text, matchType: g.match },
    },
  })));

  const headlines = [...GROUP_HEADLINES[name], ...COMMON_HEADLINES].slice(0, 15)
    .map((text) => ({ text }));
  await mutate('adGroupAds', [{
    create: {
      adGroup: adGroup.resourceName,
      status: 'ENABLED',
      ad: {
        finalUrls: [FINAL_URL],
        responsiveSearchAd: {
          headlines,
          descriptions: COMMON_DESCRIPTIONS.map((text) => ({ text })),
        },
      },
    },
  }]);
  console.log(`  ad group + keywords + RSA done`);
}

console.log('');
console.log('DONE. Campaign is PAUSED — review in Google Ads UI, then enable.');
console.log(`https://ads.google.com/aw/overview?ocid=&campaignId= (account ${customerId})`);
