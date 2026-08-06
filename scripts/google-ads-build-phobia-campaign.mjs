/**
 * Reusable campaign builder — spins up a new PAUSED search campaign for any
 * phobia landing page, using the same structure/ad-group split that is
 * converting on Fear of Flying (Hypnosis, Therapy/Treatment, How-to/Overcome,
 * Near Me). Campaigns are always created PAUSED — nothing spends until you
 * review the ad groups/keywords in the Google Ads UI (or via
 * google-ads-verify.mjs) and enable it yourself, or run this with --enable.
 *
 * Usage:
 *   node scripts/google-ads-build-phobia-campaign.mjs --slug fear-of-heights [--budget 12] [--enable]
 *   node scripts/google-ads-build-phobia-campaign.mjs --all-defaults          # builds the curated starter set below
 *
 * Credentials: same resolution as the other agent scripts (env vars, else D1 via wrangler).
 */
import { createAdsClient } from './lib/ads-client.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

// Curated starter set: well-known phobias with genuine hypnotherapy search
// demand, mirroring the market profile of Fear of Flying. Add more slugs here
// as pages go live — the keyword/ad templates below are fully generic.
const DEFAULT_SLUGS = [
  'fear-of-heights',
  'fear-of-spiders',
  'fear-of-public-speaking',
  'fear-of-driving',
  'fear-of-needles',
];

const slugsArg = arg('slug', '');
const slugs = flag('all-defaults')
  ? DEFAULT_SLUGS
  : slugsArg
    ? slugsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
if (!slugs.length) {
  console.error('Usage: node scripts/google-ads-build-phobia-campaign.mjs --slug fear-of-heights[,fear-of-spiders,...] [--budget 12] [--enable]');
  console.error('   or: node scripts/google-ads-build-phobia-campaign.mjs --all-defaults');
  process.exit(1);
}
const DAILY_BUDGET_MICROS = Math.round(Number(arg('budget', 10)) * 1e6);
const START_STATUS = flag('enable') ? 'ENABLED' : 'PAUSED';

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function slugToTopic(slug) {
  return slug.replace(/^fear-of-/, '').replace(/-/g, ' ').trim();
}

const NEGATIVES = [
  'free', 'tips', 'tricks', 'reddit', 'quora', 'forum', 'blog', 'pdf', 'book', 'books',
  'app', 'apps', 'download', 'youtube', 'video', 'course', 'class', 'online course',
  'self help', 'diy', 'at home',
  'medication', 'meds', 'pills', 'drug', 'drugs', 'xanax', 'valium', 'diazepam', 'ativan',
  'benzo', 'prescription', 'melatonin', 'alcohol', 'drink', 'drinking',
  'what is', 'definition', 'meaning', 'wikipedia', 'statistics', 'symptoms', 'causes',
  'why do', 'is it normal', 'quiz', 'test', 'dsm',
  'jobs', 'career', 'kids', 'child', 'toddler',
  'meme', 'funny', 'quotes', 'song', 'lyrics', 'movie', 'film',
  'training', 'certification', 'become a hypnotherapist', 'script', 'scripts',
];

function buildKeywordGroups(topic) {
  // topic examples: "heights", "spiders", "public speaking", "driving", "needles", "the dark"
  const phrase = `fear of ${topic}`;
  return {
    'Hypnosis / Hypnotherapy': {
      cpc: 2_000_000,
      match: 'PHRASE',
      kws: [
        `hypnosis for ${phrase}`,
        `hypnotherapy for ${phrase}`,
        `${phrase} hypnosis`,
        `${phrase} hypnotherapy`,
      ],
      // NOTE: deliberately no "hypnotherapy for X phobia" variant — Google's
      // HEALTH_IN_PERSONALIZED_ADS policy can flag "<condition> phobia" phrasing
      // as sensitive-health audience targeting (seen live on the "heights" topic).
    },
    'Therapy / Treatment': {
      cpc: 1_800_000,
      match: 'PHRASE',
      kws: [
        `${phrase} therapy`,
        `${phrase} treatment`,
        `${phrase} therapist`,
        `overcome ${phrase}`,
        `cure for ${phrase}`,
        `${phrase} help`,
      ],
    },
    'How-to / Overcome': {
      cpc: 900_000,
      match: 'PHRASE',
      kws: [
        `how to overcome ${phrase}`,
        `how to get over ${phrase}`,
        `how to stop ${phrase}`,
        `how do i overcome ${phrase}`,
        `how to cope with ${phrase}`,
      ],
    },
    'Near Me': {
      cpc: 2_200_000,
      match: 'PHRASE',
      kws: [
        `hypnotherapy for ${topic} near me`,
        `${phrase} therapy near me`,
        `${phrase} help near me`,
        `hypnotherapist near me for ${topic}`,
      ],
    },
  };
}

function fits(s, max) { return s.length <= max; }

function buildAdCopy(topic) {
  const short = titleCase(topic);
  const phrase = `fear of ${topic}`;
  const headlineCandidates = [
    `${short}? Get Help Now`,
    'Certified Hypnotherapist',
    'No Trance Required',
    'Zoom Sessions, US Wide',
    `Overcome ${short}`,
    'Book Your Session Today',
    'Relief in One Session',
    `Stop Your ${short} Fear`,
    `Hypnosis for ${short}`,
  ].filter((h) => fits(h, 30));
  // Generic fallbacks (no topic interpolation) guarantee we always clear Google's
  // 2-description minimum for a Responsive Search Ad, even with long phobia names.
  const descriptionCandidates = [
    'Work 1-on-1 with a certified clinical hypnotherapist over Zoom. No trance required.',
    `Personalized online sessions that get to the root of your ${phrase}. All 50 states.`,
    `Stop letting ${phrase} control your life. Calm, confident, and free. Book on Zoom.`,
    'Personalized 1-on-1 online sessions, all 50 states. Book your session on Zoom today.',
    'Calm, confident, and free from fear. Certified hypnotherapy sessions online.',
  ].filter((d) => fits(d, 90));
  if (headlineCandidates.length < 3) throw new Error(`Not enough valid headlines for topic "${topic}"`);
  if (descriptionCandidates.length < 2) throw new Error(`Not enough valid descriptions for topic "${topic}"`);
  // Google RSA limits: max 15 headlines, max 4 descriptions.
  return { headlines: headlineCandidates.slice(0, 15), descriptions: descriptionCandidates.slice(0, 4) };
}

async function mutate(client, resource, operations) {
  return client.mutate(resource, operations);
}

/**
 * Google's HEALTH_IN_PERSONALIZED_ADS policy is unpredictable — it can flag
 * different keyword phrasings per topic (seen on "heights" and "the dentist"
 * so far). Instead of failing the whole campaign, drop just the flagged
 * keyword(s) and retry so every campaign finishes.
 */
async function createKeywordsResilient(client, adGroupResourceName, kws, matchType) {
  let toCreate = kws.map((text) => ({
    create: { adGroup: adGroupResourceName, status: 'ENABLED', keyword: { text, matchType } },
  }));
  for (let attempt = 0; attempt < 4 && toCreate.length; attempt++) {
    try {
      await mutate(client, 'adGroupCriteria', toCreate);
      return toCreate.map((op) => op.create.keyword.text);
    } catch (e) {
      const msg = String(e.message || e);
      if (!/POLICY_ERROR/.test(msg)) throw e;
      const violating = new Set();
      const re = /"violatingText":"([^"]+)"/g;
      let m;
      while ((m = re.exec(msg))) violating.add(m[1]);
      if (!violating.size) throw e;
      toCreate = toCreate.filter((op) => !violating.has(op.create.keyword.text));
      console.warn(`  ⚠ policy-flagged, dropped: ${[...violating].join(', ')}`);
    }
  }
  return toCreate.length ? [] : [];
}

async function buildOne(client, slug) {
  const topic = slugToTopic(slug);
  const campaignName = `${titleCase(topic)} — US`;
  const finalUrl = `https://phobiafree.life/${slug}`;
  console.log(`\n=== ${campaignName} (${finalUrl}) ===`);

  const [budget] = await mutate(client, 'campaignBudgets', [{
    create: {
      name: `${titleCase(topic)} daily ${new Date().toISOString().slice(0, 10)}`,
      amountMicros: String(DAILY_BUDGET_MICROS),
      deliveryMethod: 'STANDARD',
      explicitlyShared: false,
    },
  }]);

  const campaignCreate = {
    name: campaignName,
    status: START_STATUS,
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
    [campaign] = await mutate(client, 'campaigns', [{ create: campaignCreate }]);
  } catch (e) {
    if (/containsEuPoliticalAdvertising|contains_eu_political_advertising/i.test(String(e.message))) {
      delete campaignCreate.containsEuPoliticalAdvertising;
      [campaign] = await mutate(client, 'campaigns', [{ create: campaignCreate }]);
    } else {
      throw e;
    }
  }
  console.log('Campaign:', campaign.resourceName, `(${START_STATUS})`, `budget $${DAILY_BUDGET_MICROS / 1e6}/day`);

  await mutate(client, 'campaignCriteria', [
    { create: { campaign: campaign.resourceName, location: { geoTargetConstant: 'geoTargetConstants/2840' } } },
    { create: { campaign: campaign.resourceName, language: { languageConstant: 'languageConstants/1000' } } },
    ...NEGATIVES.map((text) => ({
      create: { campaign: campaign.resourceName, negative: true, keyword: { text, matchType: 'BROAD' } },
    })),
  ]);
  console.log('Geo (US) + language (English) + negatives added.');

  const groups = buildKeywordGroups(topic);
  const { headlines, descriptions } = buildAdCopy(topic);

  for (const [name, g] of Object.entries(groups)) {
    const [adGroup] = await mutate(client, 'adGroups', [{
      create: {
        name,
        campaign: campaign.resourceName,
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: String(g.cpc),
      },
    }]);
    const created = await createKeywordsResilient(client, adGroup.resourceName, g.kws, g.match);
    if (!created.length) {
      console.warn(`  ⚠ ${name}: all keywords were policy-flagged — ad group left with no keywords, skipping ad`);
      continue;
    }
    await mutate(client, 'adGroupAds', [{
      create: {
        adGroup: adGroup.resourceName,
        status: 'ENABLED',
        ad: {
          finalUrls: [finalUrl],
          responsiveSearchAd: {
            headlines: headlines.map((text) => ({ text })),
            descriptions: descriptions.map((text) => ({ text })),
          },
        },
      },
    }]);
    console.log(`  ${name}: ${created.length}/${g.kws.length} keywords, cap $${(g.cpc / 1e6).toFixed(2)}`);
  }

  return { slug, campaignId: campaign.resourceName.split('/').pop(), campaignName, status: START_STATUS };
}

const client = await createAdsClient();
console.log(`Connected to customer ${client.customerId} (credentials: ${client.credentialSource})`);
console.log(`Building ${slugs.length} campaign(s), status=${START_STATUS}, budget=$${DAILY_BUDGET_MICROS / 1e6}/day`);

const built = [];
for (const slug of slugs) {
  try {
    built.push(await buildOne(client, slug));
  } catch (e) {
    console.error(`FAILED for ${slug}:`, String(e.message || e).slice(0, 500));
  }
}

console.log('\n===== DONE =====');
for (const b of built) console.log(`${b.status === 'ENABLED' ? '🟢' : '⏸ '} ${b.campaignName} — id ${b.campaignId} — /${b.slug}`);
if (START_STATUS === 'PAUSED') {
  console.log('\nAll campaigns created PAUSED — no spend yet. Review in Google Ads UI, then enable individually');
  console.log('(or re-run the relevant campaign with --enable) once you\'ve set real budgets.');
}
