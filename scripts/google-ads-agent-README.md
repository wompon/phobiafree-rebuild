# Google Ads analyze → apply agent

## Launching new phobia campaigns

`scripts/google-ads-build-phobia-campaign.mjs` clones the Fear of Flying campaign
structure (Hypnosis/Hypnotherapy, Therapy/Treatment, How-to/Overcome, Near Me ad
groups) onto any other `/fear-of-*` landing page. Every campaign it creates is
**PAUSED with a small budget by default — zero spend until you enable it.**

```bash
# One phobia
node scripts/google-ads-build-phobia-campaign.mjs --slug fear-of-heights --budget 10

# Several at once
node scripts/google-ads-build-phobia-campaign.mjs --slug fear-of-heights,fear-of-spiders --budget 10

# The curated starter set (heights, spiders, public speaking, driving, needles)
node scripts/google-ads-build-phobia-campaign.mjs --all-defaults --budget 10

# Skip the pause and go live immediately (only once you've reviewed it!)
node scripts/google-ads-build-phobia-campaign.mjs --slug fear-of-heights --budget 15 --enable
```

Notes learned the hard way while building the first batch:

- Google's `HEALTH_IN_PERSONALIZED_ADS` policy can flag `"<condition> phobia"`
  phrasing (e.g. "hypnotherapy for heights phobia") as sensitive-health audience
  targeting. The keyword templates avoid that pattern.
- Responsive Search Ads require **3–15 headlines** and **2–4 descriptions** —
  the ad-copy builder validates and caps both before creating the ad.
- If a build fails partway (policy error, etc.), it can leave a partial
  campaign (budget + empty ad group) behind — check with `google-ads-verify.mjs`
  (update `CAMPAIGN_ID`) and remove it via a `campaigns` mutate `{ remove: resourceName }`
  operation before re-running.


Two scripts that together act as an optimization agent for the PhobiaFree Google Ads
account. Built for the Fear of Flying campaign (`24066888224`) but works for any
campaign via `--campaign`, so it scales to future phobia campaigns.

## Workflow

```bash
# 1. Analyze: pulls live data, writes a report + an action plan
npm run ads:analyze
#    → tmp/ads-analysis/report-YYYY-MM-DD.md   (human-readable)
#    → tmp/ads-analysis/plan-YYYY-MM-DD.json   (machine-readable actions)

# 2. Review the report, edit the plan JSON to remove any action you disagree with

# 3. Dry-run the plan (prints what would change, changes nothing)
node scripts/google-ads-apply.mjs tmp/ads-analysis/plan-YYYY-MM-DD.json

# 4. Apply for real
node scripts/google-ads-apply.mjs tmp/ads-analysis/plan-YYYY-MM-DD.json --execute
```

### Analyzer options

```bash
node scripts/google-ads-analyze.mjs \
  --campaign 24066888224 \   # campaign ID (default: Fear of Flying)
  --days 30 \                # lookback window
  --goal 250 \               # promo spend goal in dollars
  --deadline 2026-08-11 \    # spend-by date
  --spend-start 2026-07-15   # date the goal counts from (default: earliest campaign start)
```

## What the analyzer checks

- **Spend pacing** — account-wide spend vs the $250-by-deadline goal, and whether
  current daily budgets can get there. It recommends fixing pacing with *budget*
  (or more campaigns), not with inflated bids.
- **Overbidding** — compares every keyword bid against Google's own top-of-page
  CPC estimate; bids >1.5x the estimate get a cut-bid action (estimate +15%).
  This directly unwinds "extreme bids used to force spend".
- **Wasted spend** — keywords with $25+ and zero conversions → pause action;
  $10+ with zero conversions → bid-down action.
- **Negative keywords** — search terms that cost $5+ with zero conversions and no
  fear/phobia/flying/hypnosis intent → exact-match campaign negative actions.
- **Winners** — converting keywords and search terms with CPA, i.e. the template
  to replicate for the next phobia campaigns.
- **Health checks** — disapproved ads, device money pits, and whether conversion
  tracking is recording anything at all (0 conversions on 30+ clicks usually means
  broken tracking or a landing-page problem, not a bidding problem).

## Action types the apply script supports

| type | effect |
| --- | --- |
| `set_keyword_bid` | update keyword max CPC |
| `pause_keyword` / `enable_keyword` | keyword status |
| `add_campaign_negative` | campaign-level negative keyword |
| `set_budget` | campaign daily budget |
| `set_campaign_status` | pause/enable a campaign |

The apply script is **dry-run by default**; `--execute` is required to mutate.

## Credentials

Resolution order:

1. **Environment variables** (recommended for Cursor Cloud Agents — add these under
   Cloud Agents → Secrets):
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_CLIENT_ID`
   - `GOOGLE_ADS_CLIENT_SECRET`
   - `GOOGLE_ADS_REFRESH_TOKEN`
   - `GOOGLE_ADS_CUSTOMER_ID` (7050636542)
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (optional, only if using an MCC)

   These are the same values already stored in the site's D1 `ark_prefs` table
   (keys `google_ads_*`) — they can be copied from the /admin Google Ads panel
   or read once with wrangler.

2. **Cloudflare D1 fallback** — if the env vars are absent the client shells out to
   `npx wrangler d1 execute phobiafree-db --remote` to read `ark_prefs`, exactly like
   the existing one-off scripts. This requires wrangler auth (`CLOUDFLARE_API_TOKEN`
   env var or `wrangler login`).
