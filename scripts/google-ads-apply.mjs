/**
 * Google Ads change agent — executes a plan produced by google-ads-analyze.mjs.
 *
 * Dry-run by default: prints every change it WOULD make. Add --execute to apply.
 * Edit the plan JSON first if you want to drop/adjust individual actions.
 *
 * Usage:
 *   node scripts/google-ads-apply.mjs tmp/ads-analysis/plan-2026-08-05.json            # dry run
 *   node scripts/google-ads-apply.mjs tmp/ads-analysis/plan-2026-08-05.json --execute  # apply
 *
 * Supported action types (each action is an object in plan.actions):
 *   set_keyword_bid        { resourceName, cpcDollars }
 *   set_ad_group_bid       { resourceName, cpcDollars }
 *   pause_keyword          { resourceName }
 *   enable_keyword         { resourceName }
 *   add_campaign_negative  { campaignResource, text, matchType }
 *   set_budget             { budgetResource, amountDollars }
 *   set_campaign_status    { campaignResource, status: ENABLED|PAUSED }
 */
import { readFileSync } from 'node:fs';
import { createAdsClient, usd } from './lib/ads-client.mjs';

const planPath = process.argv[2];
const EXECUTE = process.argv.includes('--execute');
if (!planPath) {
  console.error('Usage: node scripts/google-ads-apply.mjs <plan.json> [--execute]');
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const actions = plan.actions || [];
if (!actions.length) {
  console.log('Plan has no actions — nothing to do.');
  process.exit(0);
}

console.log(`Plan: ${planPath}`);
console.log(`Campaign: ${plan.campaignName || plan.campaignId || '(account-level)'} · ${actions.length} action(s)`);
console.log(EXECUTE ? 'MODE: EXECUTE — changes WILL be applied.\n' : 'MODE: DRY RUN — nothing will change (add --execute to apply).\n');

function describe(a) {
  switch (a.type) {
    case 'set_keyword_bid': return `Set bid ${usd(a.cpcDollars)} on ${a.keyword || a.resourceName}`;
    case 'set_ad_group_bid': return `Set ad group max CPC ${usd(a.cpcDollars)} on ${a.adGroup || a.resourceName}`;
    case 'pause_keyword': return `Pause keyword ${a.keyword || a.resourceName}`;
    case 'enable_keyword': return `Enable keyword ${a.keyword || a.resourceName}`;
    case 'add_campaign_negative': return `Add campaign negative [${a.matchType}] "${a.text}"`;
    case 'set_budget': return `Set daily budget to ${usd(a.amountDollars)}`;
    case 'set_campaign_status': return `Set campaign status → ${a.status}`;
    default: return `UNKNOWN action type "${a.type}"`;
  }
}

// Group into per-resource mutate batches.
const batches = { adGroupCriteria: [], adGroups: [], campaignCriteria: [], campaignBudgets: [], campaigns: [] };
const skipped = [];
for (const a of actions) {
  switch (a.type) {
    case 'set_keyword_bid':
      batches.adGroupCriteria.push({
        update: { resourceName: a.resourceName, cpcBidMicros: String(Math.round(Number(a.cpcDollars) * 1e6)) },
        updateMask: 'cpc_bid_micros',
      });
      break;
    case 'set_ad_group_bid':
      batches.adGroups.push({
        update: { resourceName: a.resourceName, cpcBidMicros: String(Math.round(Number(a.cpcDollars) * 1e6)) },
        updateMask: 'cpc_bid_micros',
      });
      break;
    case 'pause_keyword':
    case 'enable_keyword':
      batches.adGroupCriteria.push({
        update: { resourceName: a.resourceName, status: a.type === 'pause_keyword' ? 'PAUSED' : 'ENABLED' },
        updateMask: 'status',
      });
      break;
    case 'add_campaign_negative':
      batches.campaignCriteria.push({
        create: {
          campaign: a.campaignResource,
          negative: true,
          keyword: { text: a.text, matchType: a.matchType || 'EXACT' },
        },
      });
      break;
    case 'set_budget':
      batches.campaignBudgets.push({
        update: { resourceName: a.budgetResource, amountMicros: String(Math.round(Number(a.amountDollars) * 1e6)) },
        updateMask: 'amount_micros',
      });
      break;
    case 'set_campaign_status':
      batches.campaigns.push({
        update: { resourceName: a.campaignResource, status: a.status },
        updateMask: 'status',
      });
      break;
    default:
      skipped.push(a);
  }
  console.log(`  ${skipped.includes(a) ? 'SKIP' : EXECUTE ? 'DO  ' : 'PLAN'}  ${describe(a)}`);
  if (a.reason) console.log(`        ↳ ${a.reason}`);
}

if (!EXECUTE) {
  console.log('\nDry run complete. Re-run with --execute to apply.');
  process.exit(0);
}

const client = await createAdsClient();
if (plan.customerId && plan.customerId !== client.customerId) {
  throw new Error(`Plan was generated for customer ${plan.customerId} but credentials are for ${client.customerId}`);
}

// De-duplicate multiple updates to the same resource+mask (last one wins) to
// avoid API "duplicate resource in mutate" errors.
function dedupe(ops) {
  const seen = new Map();
  for (const op of ops) {
    const key = op.update ? `${op.update.resourceName}|${op.updateMask}` : JSON.stringify(op.create);
    seen.set(key, op);
  }
  return [...seen.values()];
}

for (const [resource, ops] of Object.entries(batches)) {
  if (!ops.length) continue;
  const unique = dedupe(ops);
  const results = await client.mutate(resource, unique);
  console.log(`\n${resource}: applied ${results.length}/${unique.length} operation(s)`);
}
if (skipped.length) console.log(`Skipped ${skipped.length} unknown action(s).`);
console.log('\nDONE. Re-run the analyzer in a day or two to measure the effect.');
