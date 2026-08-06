/**
 * Shared Google Ads API client for the analyze/apply agent scripts.
 *
 * Credential resolution order:
 *   1. Environment variables (best for cloud agents / CI):
 *      GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *      GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional)
 *   2. Remote D1 ark_prefs via `wrangler d1 execute` (how the existing one-off
 *      scripts work — requires wrangler auth, e.g. CLOUDFLARE_API_TOKEN).
 */
import { execFileSync } from 'node:child_process';

const API = 'v22';

export const DEFAULT_CAMPAIGN_ID = '24066888224'; // PhobiaFree — Fear of Flying

function fromEnv() {
  const e = process.env;
  const creds = {
    developer_token: e.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    client_id: e.GOOGLE_ADS_CLIENT_ID || '',
    client_secret: e.GOOGLE_ADS_CLIENT_SECRET || '',
    refresh_token: e.GOOGLE_ADS_REFRESH_TOKEN || '',
    customer_id: e.GOOGLE_ADS_CUSTOMER_ID || '',
    login_customer_id: e.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
  };
  const required = ['developer_token', 'client_id', 'client_secret', 'refresh_token', 'customer_id'];
  return required.every((k) => creds[k]) ? creds : null;
}

function fromD1() {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'phobiafree-db', '--remote', '-c', 'wrangler-site.jsonc', '--json',
      `--command="SELECT key, value FROM ark_prefs WHERE key LIKE 'google_ads%';"`],
    { encoding: 'utf8', cwd: process.cwd(), shell: true },
  );
  const start = out.search(/\[\s*[{\]]/);
  const parsed = JSON.parse(start >= 0 ? out.slice(start) : out);
  let results = [];
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) if (parsed[i]?.results) { results = parsed[i].results; break; }
  } else {
    results = parsed?.results || [];
  }
  return Object.fromEntries(results.map((r) => [String(r.key).replace(/^google_ads_/, ''), r.value]));
}

export async function createAdsClient() {
  let creds = fromEnv();
  let source = 'env';
  if (!creds) {
    try {
      creds = fromD1();
      source = 'd1';
    } catch (e) {
      throw new Error(
        'No Google Ads credentials found. Either set GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / '
        + 'GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN / GOOGLE_ADS_CUSTOMER_ID env vars, or provide '
        + `Cloudflare auth so wrangler can read the D1 ark_prefs store (${String(e.message || e).slice(0, 200)})`,
      );
    }
  }

  const customerId = String(creds.customer_id || '').replace(/\D/g, '');
  const loginCustomerId = String(creds.login_customer_id || '').replace(/\D/g, '');
  if (!customerId) throw new Error('Missing Google Ads customer ID');

  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('OAuth refresh failed: ' + JSON.stringify(tok).slice(0, 300));

  const headers = () => {
    const h = {
      Authorization: `Bearer ${tok.access_token}`,
      'developer-token': creds.developer_token,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
    return h;
  };

  async function gaql(query) {
    const res = await fetch(
      `https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`,
      { method: 'POST', headers: headers(), body: JSON.stringify({ query }) },
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 500)); }
    if (!res.ok) {
      const msg = data?.error?.details?.[0]?.errors?.[0]?.message
        || data?.[0]?.error?.details?.[0]?.errors?.[0]?.message
        || data?.error?.message || data?.[0]?.error?.message || text.slice(0, 500);
      throw new Error(msg);
    }
    const rows = [];
    for (const chunk of (Array.isArray(data) ? data : [])) {
      for (const row of (chunk.results || [])) rows.push(row);
    }
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
    if (!res.ok) {
      throw new Error(`${resource} failed: ${JSON.stringify(data?.error?.details || data?.error?.message || data).slice(0, 1500)}`);
    }
    return data.results || [];
  }

  return { customerId, loginCustomerId, gaql, mutate, credentialSource: source };
}

export function microsToDollars(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e6 : 0;
}

export function usd(n) {
  return '$' + Number(n || 0).toFixed(2);
}
