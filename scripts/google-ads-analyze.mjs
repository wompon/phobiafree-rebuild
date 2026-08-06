/**
 * Google Ads analysis agent for PhobiaFree campaigns.
 *
 * Pulls live performance data for one campaign (default: Fear of Flying,
 * 24066888224) plus account-level spend, then produces:
 *   - a markdown report        → tmp/ads-analysis/report-YYYY-MM-DD.md
 *   - a machine-readable plan  → tmp/ads-analysis/plan-YYYY-MM-DD.json
 *     (feed the plan to scripts/google-ads-apply.mjs to execute changes)
 *
 * Usage:
 *   node scripts/google-ads-analyze.mjs [--campaign 24066888224] [--days 30]
 *     [--goal 250] [--deadline 2026-08-11] [--spend-start YYYY-MM-DD]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdsClient, microsToDollars, usd, DEFAULT_CAMPAIGN_ID } from './lib/ads-client.mjs';

// ---------- args ----------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CAMPAIGN_ID = String(arg('campaign', DEFAULT_CAMPAIGN_ID)).replace(/\D/g, '');
const DAYS = Math.max(1, Number(arg('days', 30)));
const SPEND_GOAL = Number(arg('goal', 500)); // total promo tier: $500 spend unlocks next $1000 credit
const DEADLINE = arg('deadline', '2026-08-11');
const SPEND_START = arg('spend-start', ''); // default: earliest campaign start date

function isoDate(d) { return d.toISOString().slice(0, 10); }
const today = new Date();
const rangeEnd = isoDate(today);
const rangeStart = isoDate(new Date(today.getTime() - (DAYS - 1) * 86400e3));
const DATE_RANGE = `segments.date BETWEEN '${rangeStart}' AND '${rangeEnd}'`;

const client = await createAdsClient();
console.log(`Connected to customer ${client.customerId} (credentials: ${client.credentialSource})`);
console.log(`Analyzing campaign ${CAMPAIGN_ID}, last ${DAYS} days (${rangeStart} → ${rangeEnd})`);

// ---------- data pulls ----------
const campaigns = await client.gaql(`
  SELECT campaign.id, campaign.name, campaign.status, campaign.start_date,
    campaign.bidding_strategy_type, campaign_budget.amount_micros, campaign_budget.resource_name,
    metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
  FROM campaign
  WHERE campaign.status != 'REMOVED' AND ${DATE_RANGE}
`);
const campaignRow = campaigns.find((r) => String(r.campaign?.id) === CAMPAIGN_ID);
if (!campaignRow) throw new Error(`Campaign ${CAMPAIGN_ID} not found (or no data in range)`);
const camp = {
  name: campaignRow.campaign.name,
  status: campaignRow.campaign.status,
  startDate: campaignRow.campaign.startDate,
  bidding: campaignRow.campaign.biddingStrategyType,
  budget: microsToDollars(campaignRow.campaignBudget.amountMicros),
  budgetResource: campaignRow.campaignBudget.resourceName,
  cost: microsToDollars(campaignRow.metrics?.costMicros),
  clicks: Number(campaignRow.metrics?.clicks || 0),
  impressions: Number(campaignRow.metrics?.impressions || 0),
  conversions: Number(campaignRow.metrics?.conversions || 0),
};

const dailyRows = await client.gaql(`
  SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions,
    metrics.conversions, metrics.average_cpc
  FROM campaign
  WHERE campaign.id = ${CAMPAIGN_ID} AND ${DATE_RANGE}
  ORDER BY segments.date
`);
const daily = dailyRows.map((r) => ({
  date: r.segments.date,
  cost: microsToDollars(r.metrics?.costMicros),
  clicks: Number(r.metrics?.clicks || 0),
  impressions: Number(r.metrics?.impressions || 0),
  conversions: Number(r.metrics?.conversions || 0),
  avgCpc: microsToDollars(r.metrics?.averageCpc),
}));

// Account-wide spend since SPEND_START (for the $250-by-deadline pacing goal).
const spendStart = SPEND_START
  || campaigns.map((r) => r.campaign.startDate).filter(Boolean).sort()[0]
  || rangeStart;
const accountSpendRows = await client.gaql(`
  SELECT metrics.cost_micros FROM customer
  WHERE segments.date BETWEEN '${spendStart}' AND '${rangeEnd}'
`);
const accountSpend = accountSpendRows.reduce((s, r) => s + microsToDollars(r.metrics?.costMicros), 0);

// Keywords, with bids and Google's own top-of-page CPC estimates when available.
const kwFields = `
  SELECT ad_group.id, ad_group.name,
    ad_group_criterion.criterion_id, ad_group_criterion.status,
    ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.cpc_bid_micros,
    {POS}
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.average_cpc, metrics.conversions, metrics.ctr
  FROM keyword_view
  WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_criterion.status != 'REMOVED'
    AND ${DATE_RANGE}
  ORDER BY metrics.cost_micros DESC
`;
let kwRows;
try {
  kwRows = await client.gaql(kwFields.replace('{POS}',
    'ad_group_criterion.position_estimates.top_of_page_cpc_micros, ad_group_criterion.position_estimates.first_page_cpc_micros,'));
} catch {
  kwRows = await client.gaql(kwFields.replace('{POS}', ''));
}
const keywords = kwRows.map((r) => ({
  adGroupId: String(r.adGroup.id),
  adGroup: r.adGroup.name,
  criterionId: String(r.adGroupCriterion.criterionId),
  resourceName: `customers/${client.customerId}/adGroupCriteria/${r.adGroup.id}~${r.adGroupCriterion.criterionId}`,
  text: r.adGroupCriterion.keyword?.text || '',
  matchType: r.adGroupCriterion.keyword?.matchType || '',
  status: r.adGroupCriterion.status,
  bid: microsToDollars(r.adGroupCriterion.cpcBidMicros),
  topOfPageCpc: microsToDollars(r.adGroupCriterion.positionEstimates?.topOfPageCpcMicros),
  firstPageCpc: microsToDollars(r.adGroupCriterion.positionEstimates?.firstPageCpcMicros),
  impressions: Number(r.metrics?.impressions || 0),
  clicks: Number(r.metrics?.clicks || 0),
  cost: microsToDollars(r.metrics?.costMicros),
  avgCpc: microsToDollars(r.metrics?.averageCpc),
  conversions: Number(r.metrics?.conversions || 0),
  ctr: Number(r.metrics?.ctr || 0),
}));

const stRows = await client.gaql(`
  SELECT search_term_view.search_term, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
  FROM search_term_view
  WHERE campaign.id = ${CAMPAIGN_ID} AND ${DATE_RANGE}
  ORDER BY metrics.cost_micros DESC
  LIMIT 500
`);
const searchTerms = stRows.map((r) => ({
  term: r.searchTermView.searchTerm,
  adGroup: r.adGroup?.name || '',
  impressions: Number(r.metrics?.impressions || 0),
  clicks: Number(r.metrics?.clicks || 0),
  cost: microsToDollars(r.metrics?.costMicros),
  conversions: Number(r.metrics?.conversions || 0),
}));

const deviceRows = await client.gaql(`
  SELECT segments.device, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.impressions
  FROM campaign WHERE campaign.id = ${CAMPAIGN_ID} AND ${DATE_RANGE}
`);
const devices = deviceRows.map((r) => ({
  device: r.segments.device,
  impressions: Number(r.metrics?.impressions || 0),
  clicks: Number(r.metrics?.clicks || 0),
  cost: microsToDollars(r.metrics?.costMicros),
  conversions: Number(r.metrics?.conversions || 0),
}));

const adRows = await client.gaql(`
  SELECT ad_group.name, ad_group_ad.ad.id, ad_group_ad.status,
    ad_group_ad.policy_summary.approval_status,
    metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, metrics.cost_micros
  FROM ad_group_ad
  WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_ad.status != 'REMOVED' AND ${DATE_RANGE}
`);
const ads = adRows.map((r) => ({
  adGroup: r.adGroup.name,
  adId: String(r.adGroupAd.ad.id),
  status: r.adGroupAd.status,
  approval: r.adGroupAd.policySummary?.approvalStatus || 'UNKNOWN',
  impressions: Number(r.metrics?.impressions || 0),
  clicks: Number(r.metrics?.clicks || 0),
  ctr: Number(r.metrics?.ctr || 0),
  conversions: Number(r.metrics?.conversions || 0),
  cost: microsToDollars(r.metrics?.costMicros),
}));

let convActions = [];
try {
  const caRows = await client.gaql(`
    SELECT conversion_action.name, conversion_action.type, conversion_action.status,
      metrics.all_conversions
    FROM conversion_action WHERE ${DATE_RANGE}
  `);
  convActions = caRows.map((r) => ({
    name: r.conversionAction.name,
    type: r.conversionAction.type,
    status: r.conversionAction.status,
    allConversions: Number(r.metrics?.allConversions || 0),
  })).filter((c) => c.allConversions > 0 || c.status === 'ENABLED');
} catch (e) {
  console.warn('conversion_action report unavailable:', String(e.message || e).slice(0, 120));
}

// ---------- analysis ----------
const actions = [];
const notes = [];

// 1. Spend pacing toward the promo goal.
const msLeft = new Date(`${DEADLINE}T23:59:59Z`).getTime() - today.getTime();
const daysLeft = Math.max(0, Math.ceil(msLeft / 86400e3));
const remaining = Math.max(0, SPEND_GOAL - accountSpend);
const neededPerDay = daysLeft > 0 ? remaining / daysLeft : remaining;
const totalDailyBudget = campaigns
  .filter((r) => r.campaign.status === 'ENABLED')
  .reduce((s, r) => s + microsToDollars(r.campaignBudget.amountMicros), 0);
notes.push(
  `Spend goal: ${usd(accountSpend)} spent since ${spendStart} of ${usd(SPEND_GOAL)} goal — `
  + `${usd(remaining)} remaining over ${daysLeft} day(s) → need ~${usd(neededPerDay)}/day. `
  + `Current enabled daily budgets total ${usd(totalDailyBudget)}/day.`,
);
if (remaining > 0 && totalDailyBudget < neededPerDay) {
  notes.push(
    `PACING: budgets (${usd(totalDailyBudget)}/day) are below the required ${usd(neededPerDay)}/day. `
    + `Prefer raising BUDGET and/or launching more phobia campaigns over raising bids — `
    + `extreme bids buy the same clicks at higher prices and teach you nothing about profitability.`,
  );
}

// 2. Overbidding vs Google's top-of-page estimates (fixes the "extreme bids" problem).
const enabledKws = keywords.filter((k) => k.status === 'ENABLED');
for (const k of enabledKws) {
  if (k.bid > 0 && k.topOfPageCpc > 0 && k.bid > k.topOfPageCpc * 1.5) {
    const newBid = Math.max(0.10, Math.round(k.topOfPageCpc * 1.15 * 100) / 100);
    actions.push({
      type: 'set_keyword_bid',
      resourceName: k.resourceName,
      keyword: `${k.text} [${k.matchType}] (${k.adGroup})`,
      cpcDollars: newBid,
      reason: `Bid ${usd(k.bid)} is ${(k.bid / k.topOfPageCpc).toFixed(1)}x the est. top-of-page CPC `
        + `${usd(k.topOfPageCpc)} — cut to ${usd(newBid)} (top-of-page +15%). Avg CPC paid: ${usd(k.avgCpc)}.`,
    });
  }
}

// 3. Wasted spend: keywords burning money with zero conversions.
for (const k of enabledKws) {
  if (k.conversions === 0 && k.cost >= 25) {
    actions.push({
      type: 'pause_keyword',
      resourceName: k.resourceName,
      keyword: `${k.text} [${k.matchType}] (${k.adGroup})`,
      reason: `${usd(k.cost)} spent, ${k.clicks} clicks, 0 conversions in ${DAYS} days.`,
    });
  } else if (k.conversions === 0 && k.cost >= 10 && !actions.some((a) => a.resourceName === k.resourceName)) {
    const target = Math.max(0.10, Math.round((k.avgCpc * 0.6) * 100) / 100);
    actions.push({
      type: 'set_keyword_bid',
      resourceName: k.resourceName,
      keyword: `${k.text} [${k.matchType}] (${k.adGroup})`,
      cpcDollars: target,
      reason: `${usd(k.cost)} spent with 0 conversions — reduce bid to ${usd(target)} (60% of avg CPC) instead of pausing.`,
    });
  }
}

// 4. Negative keyword candidates from search terms.
const INTENT_OK = /(fear|phobia|afraid|scared|anxiet|anxious|panic|flight|flying|fly|plane|hypno|therap|cure|overcome|help|treatment)/i;
const negativeCandidates = searchTerms.filter((t) =>
  t.conversions === 0 && t.cost >= 5 && !INTENT_OK.test(t.term));
for (const t of negativeCandidates.slice(0, 40)) {
  actions.push({
    type: 'add_campaign_negative',
    campaignResource: `customers/${client.customerId}/campaigns/${CAMPAIGN_ID}`,
    text: t.term,
    matchType: 'EXACT',
    reason: `Search term "${t.term}" cost ${usd(t.cost)} (${t.clicks} clicks) with 0 conversions and no phobia/flying intent.`,
  });
}

// 5. Winners: what to protect and replicate for other phobias.
const winners = [
  ...enabledKws.filter((k) => k.conversions > 0).map((k) => ({
    kind: 'keyword', label: `${k.text} [${k.matchType}]`, cost: k.cost, conversions: k.conversions,
    cpa: k.cost / k.conversions,
  })),
];
const convertingTerms = searchTerms.filter((t) => t.conversions > 0);

// 6. Device performance notes.
for (const d of devices) {
  if (d.cost >= 20 && d.conversions === 0) {
    notes.push(`DEVICE: ${d.device} spent ${usd(d.cost)} (${d.clicks} clicks) with 0 conversions — `
      + `consider a negative bid adjustment or excluding it once data confirms.`);
  }
}

// 7. Ad health.
for (const a of ads) {
  if (a.status === 'ENABLED' && /DISAPPROVED|LIMITED/i.test(a.approval)) {
    notes.push(`AD: ad ${a.adId} in "${a.adGroup}" is ${a.approval} — fix policy issues, it limits delivery.`);
  }
}
if (camp.conversions === 0 && camp.clicks >= 30) {
  notes.push(
    `CONVERSIONS: ${camp.clicks} clicks and 0 recorded conversions. Before judging keywords, verify conversion `
    + `tracking is firing (see conversion actions list in the report). If tracking is fine, the landing page / `
    + `offer needs work — no bid strategy can fix a page that doesn't convert.`,
  );
}

// ---------- outputs ----------
const outDir = join(process.cwd(), 'tmp', 'ads-analysis');
mkdirSync(outDir, { recursive: true });
const stamp = rangeEnd;

const plan = {
  generatedAt: new Date().toISOString(),
  customerId: client.customerId,
  campaignId: CAMPAIGN_ID,
  campaignName: camp.name,
  window: { start: rangeStart, end: rangeEnd },
  pacing: { goal: SPEND_GOAL, deadline: DEADLINE, spentSince: spendStart, accountSpend, remaining, daysLeft, neededPerDay, totalDailyBudget },
  actions,
};
const planPath = join(outDir, `plan-${stamp}.json`);
writeFileSync(planPath, JSON.stringify(plan, null, 2));

function table(rows, cols) {
  if (!rows.length) return '_none_\n';
  const head = `| ${cols.map((c) => c.h).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${cols.map((c) => c.f(r)).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}\n`;
}
const pct = (n) => `${(n * 100).toFixed(1)}%`;

const report = `# Google Ads report — ${camp.name}
Generated ${new Date().toISOString()} · window ${rangeStart} → ${rangeEnd} · customer ${client.customerId}

## Campaign
- Status: **${camp.status}** · bidding: **${camp.bidding}** · daily budget: **${usd(camp.budget)}**
- ${DAYS}-day totals: ${usd(camp.cost)} spent · ${camp.impressions} impressions · ${camp.clicks} clicks · **${camp.conversions} conversions**${camp.conversions > 0 ? ` · CPA ${usd(camp.cost / camp.conversions)}` : ''}

## Spend pacing ($${SPEND_GOAL} by ${DEADLINE})
- Account spend since ${spendStart}: **${usd(accountSpend)}** → remaining **${usd(remaining)}** over **${daysLeft} day(s)** = **${usd(neededPerDay)}/day** needed
- Enabled daily budgets across account: ${usd(totalDailyBudget)}/day

## Daily trend
${table(daily, [
  { h: 'Date', f: (r) => r.date },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Clicks', f: (r) => r.clicks },
  { h: 'Avg CPC', f: (r) => usd(r.avgCpc) },
  { h: 'Conv', f: (r) => r.conversions },
])}

## Keywords by cost (top 25)
${table(keywords.slice(0, 25), [
  { h: 'Keyword', f: (r) => r.text },
  { h: 'Match', f: (r) => r.matchType },
  { h: 'Status', f: (r) => r.status },
  { h: 'Bid', f: (r) => usd(r.bid) },
  { h: 'Top-of-page est.', f: (r) => r.topOfPageCpc ? usd(r.topOfPageCpc) : '—' },
  { h: 'Avg CPC', f: (r) => usd(r.avgCpc) },
  { h: 'Clicks', f: (r) => r.clicks },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
])}

## Search terms by cost (top 25)
${table(searchTerms.slice(0, 25), [
  { h: 'Term', f: (r) => r.term },
  { h: 'Clicks', f: (r) => r.clicks },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
])}

## Converting search terms (replicate these for other phobias)
${table(convertingTerms, [
  { h: 'Term', f: (r) => r.term },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
  { h: 'CPA', f: (r) => usd(r.cost / r.conversions) },
])}

## Devices
${table(devices, [
  { h: 'Device', f: (r) => r.device },
  { h: 'Impr', f: (r) => r.impressions },
  { h: 'Clicks', f: (r) => r.clicks },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
])}

## Ads
${table(ads, [
  { h: 'Ad group', f: (r) => r.adGroup },
  { h: 'Ad ID', f: (r) => r.adId },
  { h: 'Approval', f: (r) => r.approval },
  { h: 'Impr', f: (r) => r.impressions },
  { h: 'CTR', f: (r) => pct(r.ctr) },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
])}

## Conversion actions (is tracking firing?)
${table(convActions, [
  { h: 'Name', f: (r) => r.name },
  { h: 'Type', f: (r) => r.type },
  { h: 'Status', f: (r) => r.status },
  { h: 'All conv (window)', f: (r) => r.allConversions },
])}

## Findings
${notes.map((n) => `- ${n}`).join('\n') || '_none_'}

## Winning keywords
${table(winners, [
  { h: 'Keyword', f: (r) => r.label },
  { h: 'Cost', f: (r) => usd(r.cost) },
  { h: 'Conv', f: (r) => r.conversions },
  { h: 'CPA', f: (r) => usd(r.cpa) },
])}

## Recommended actions (${actions.length})
${actions.map((a, i) => `${i + 1}. **${a.type}** — ${a.keyword || a.text || ''}\n   ${a.reason}`).join('\n') || '_none_'}

---
Apply with: \`node scripts/google-ads-apply.mjs ${planPath.replace(process.cwd() + '/', '')} --execute\`
(dry-run first by omitting \`--execute\`)
`;

const reportPath = join(outDir, `report-${stamp}.md`);
writeFileSync(reportPath, report);

console.log('\n===== SUMMARY =====');
console.log(`Campaign: ${camp.name} (${camp.status}) — budget ${usd(camp.budget)}/day, bidding ${camp.bidding}`);
console.log(`${DAYS}d: ${usd(camp.cost)} spent, ${camp.clicks} clicks, ${camp.conversions} conversions`);
console.log(`Pacing: ${usd(accountSpend)} of ${usd(SPEND_GOAL)} since ${spendStart}; need ${usd(neededPerDay)}/day for ${daysLeft} day(s)`);
for (const n of notes) console.log('•', n);
console.log(`\nRecommended actions: ${actions.length}`);
for (const a of actions.slice(0, 15)) console.log(`  - [${a.type}] ${a.keyword || a.text || ''} — ${a.reason}`);
if (actions.length > 15) console.log(`  … and ${actions.length - 15} more (see plan file)`);
console.log(`\nReport: ${reportPath}`);
console.log(`Plan:   ${planPath}`);
