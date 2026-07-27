/**
 * Set final URL suffix on campaign 24066888224 so clicks carry keyword/matchtype/ad
 * into the site tracker (visitor log already parses utm_* + gclid).
 * Usage: node scripts/google-ads-set-tracking.mjs
 */
import { execSync } from 'node:child_process';

const API = 'v22';
const cwd = process.cwd();
const CAMPAIGN_ID = '24066888224';
const SUFFIX = 'utm_source=google&utm_medium=cpc&utm_campaign=fof-us&utm_term={keyword}&utm_content={creative}&matchtype={matchtype}&device={device}';

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

const h = {
  Authorization: `Bearer ${tok.access_token}`,
  'developer-token': prefs.developer_token,
  'Content-Type': 'application/json',
};
if (loginCustomerId) h['login-customer-id'] = loginCustomerId;

const res = await fetch(
  `https://googleads.googleapis.com/${API}/customers/${customerId}/campaigns:mutate`,
  {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      operations: [{
        update: {
          resourceName: `customers/${customerId}/campaigns/${CAMPAIGN_ID}`,
          finalUrlSuffix: SUFFIX,
        },
        updateMask: 'final_url_suffix',
      }],
    }),
  },
);
const data = await res.json();
if (!res.ok) throw new Error(JSON.stringify(data?.error || data).slice(0, 800));
console.log('DONE — every ad click now lands with keyword + matchtype + device in the URL.');
