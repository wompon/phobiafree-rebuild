/**
 * Google Ads API (REST) — OAuth refresh + GAQL searchStream → D1 rows.
 * Secrets (wrangler): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET
 * Prefs (D1 ark_prefs): google_ads_customer_id, google_ads_login_customer_id, google_ads_refresh_token
 */

const GOOGLE_ADS_REDIRECT_URI = 'https://phobiafree.life/admin';
const GOOGLE_ADS_REDIRECT_URI_WWW = 'https://www.phobiafree.life/admin';
// Keep on a currently supported major (see Google Ads sunset table). v18/v20 are dead → HTML 404.
const ADS_API_VERSION = 'v22';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/adwords';

export { GOOGLE_ADS_REDIRECT_URI, GOOGLE_ADS_REDIRECT_URI_WWW };

export function normalizeOAuthClientId(raw) {
  let s = String(raw || '').trim();
  // Common paste junk
  s = s.replace(/^client[_ ]?id\s*[:=]\s*/i, '');
  s = s.replace(/^["']|["']$/g, '');
  s = s.replace(/\s+/g, '');
  // Bullet placeholders accidentally saved as the ID
  if (/^[•·.…]{3,}$/.test(s) || s.includes('•')) s = '';
  return s;
}

export function normalizeOAuthClientSecret(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^client[_ ]?secret\s*[:=]\s*/i, '');
  s = s.replace(/^["']|["']$/g, '');
  s = s.replace(/\s+/g, '');
  return s;
}

export function googleAdsConfigStatus(env, prefs = {}) {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN || prefs.developer_token || '';
  const clientId = normalizeOAuthClientId(env.GOOGLE_ADS_CLIENT_ID || prefs.client_id || '');
  const clientSecret = normalizeOAuthClientSecret(env.GOOGLE_ADS_CLIENT_SECRET || prefs.client_secret || '');
  const refreshToken = prefs.refresh_token || env.GOOGLE_ADS_REFRESH_TOKEN || '';
  const customerId = normalizeCustomerId(prefs.customer_id || env.GOOGLE_ADS_CUSTOMER_ID || '');
  const loginCustomerId = normalizeCustomerId(prefs.login_customer_id || env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const clientIdValid = /\.apps\.googleusercontent\.com$/i.test(clientId);

  return {
    hasDeveloperToken: !!developerToken,
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    hasRefreshToken: !!refreshToken,
    customerId,
    loginCustomerId,
    clientId, // safe to show — Google puts it in the authorize URL anyway
    clientIdHint: clientId ? `${clientId.slice(0, 16)}…${clientId.slice(-20)}` : '',
    clientIdValid,
    ready: !!(developerToken && clientId && clientIdValid && clientSecret && refreshToken && customerId),
    oauthReady: !!(clientId && clientIdValid && clientSecret),
    missing: [
      !customerId && 'Customer ID',
      !developerToken && 'Developer token',
      !clientId && 'OAuth client ID',
      clientId && !clientIdValid && 'OAuth client ID looks incomplete (must end with .apps.googleusercontent.com)',
      !clientSecret && 'OAuth client secret',
      !refreshToken && 'Authorize Google (OAuth)',
    ].filter(Boolean),
  };
}

export function normalizeCustomerId(raw) {
  return String(raw || '').replace(/\D/g, '');
}

export async function loadGoogleAdsPrefs(env) {
  const keys = [
    'google_ads_customer_id',
    'google_ads_login_customer_id',
    'google_ads_refresh_token',
    'google_ads_developer_token',
    'google_ads_client_id',
    'google_ads_client_secret',
    'google_ads_last_sync',
    'google_ads_last_error',
  ];
  const out = {};
  for (const key of keys) {
    const row = await env.phobiafree_db.prepare('SELECT value FROM ark_prefs WHERE key = ?').bind(key).first();
    if (row?.value != null) {
      const short = key.replace(/^google_ads_/, '');
      out[short] = row.value;
    }
  }
  return out;
}

export async function saveGoogleAdsPref(env, key, value) {
  await env.phobiafree_db.prepare(`
    INSERT INTO ark_prefs (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(`google_ads_${key}`, String(value ?? '')).run();
}

export function buildGoogleAdsAuthUrl(env, prefs, redirectUri, state) {
  const clientId = normalizeOAuthClientId(env.GOOGLE_ADS_CLIENT_ID || prefs.client_id);
  if (!clientId) throw new Error('Missing Google Ads OAuth client ID');
  if (!/\.apps\.googleusercontent\.com$/i.test(clientId)) {
    throw new Error('Client ID must end with .apps.googleusercontent.com — re-copy the full ID from Cloud Credentials');
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', OAUTH_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state || 'ads');
  return u.toString();
}

export async function exchangeGoogleAdsCode(env, prefs, code, redirectUri) {
  const clientId = normalizeOAuthClientId(env.GOOGLE_ADS_CLIENT_ID || prefs.client_id);
  const clientSecret = normalizeOAuthClientSecret(env.GOOGLE_ADS_CLIENT_SECRET || prefs.client_secret);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token && !data.access_token) {
    throw new Error(data.error_description || data.error || 'OAuth token exchange failed');
  }
  if (data.refresh_token) {
    await saveGoogleAdsPref(env, 'refresh_token', data.refresh_token);
  }
  await saveGoogleAdsPref(env, 'last_error', '');
  return data;
}

export async function getAccessToken(env, prefs) {
  const clientId = normalizeOAuthClientId(env.GOOGLE_ADS_CLIENT_ID || prefs.client_id);
  const clientSecret = normalizeOAuthClientSecret(env.GOOGLE_ADS_CLIENT_SECRET || prefs.client_secret);
  const refreshToken = prefs.refresh_token || env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Ads OAuth not configured (client id/secret + refresh token)');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to refresh Google Ads access token');
  }
  return data.access_token;
}

/** Accounts the current OAuth user can see via API. */
export async function listAccessibleGoogleAdsAccounts(env, prefs) {
  const accessToken = await getAccessToken(env, prefs);
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN || prefs.developer_token;
  if (!developerToken) throw new Error('Missing developer token');

  const listRes = await fetch(`https://googleads.googleapis.com/${ADS_API_VERSION}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
    },
  });
  const listData = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    throw new Error(listData?.error?.message || 'Failed to list Google Ads accounts');
  }

  const ids = (listData.resourceNames || []).map((rn) => String(rn).replace(/\D/g, '')).filter(Boolean);
  const accounts = [];
  for (const id of ids) {
    const info = {
      customerId: id,
      name: '',
      manager: false,
      keywordSample: [],
      keywordCount: null,
      error: null,
    };
    try {
      const rows = await searchStreamWithToken(env, prefs, accessToken, id, `
        SELECT customer.id, customer.descriptive_name, customer.manager
        FROM customer LIMIT 1
      `, '');
      const c = rows[0]?.customer;
      info.name = c?.descriptiveName || '';
      info.manager = !!c?.manager;
      if (!info.manager) {
        const kws = await searchStreamWithToken(env, prefs, accessToken, id, `
          SELECT ad_group_criterion.keyword.text
          FROM keyword_view
          WHERE segments.date DURING LAST_30_DAYS
          LIMIT 200
        `, '');
        info.keywordCount = kws.length;
        info.keywordSample = kws.slice(0, 5).map((r) => r.adGroupCriterion?.keyword?.text).filter(Boolean);
      }
    } catch (e) {
      info.error = String(e.message || e).slice(0, 200);
    }
    accounts.push(info);
  }
  return accounts;
}

async function searchStreamWithToken(env, prefs, accessToken, customerId, query, loginCustomerId) {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN || prefs.developer_token;
  const url = `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = null; }
  if (!res.ok) {
    const msg = data?.error?.details?.[0]?.errors?.[0]?.message
      || data?.error?.message
      || text.slice(0, 200)
      || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const rows = [];
  const chunks = Array.isArray(data) ? data : (data?.results ? [data] : []);
  for (const chunk of chunks) {
    for (const row of (chunk.results || [])) rows.push(row);
  }
  return rows;
}

async function searchStream(env, prefs, query) {
  const status = googleAdsConfigStatus(env, prefs);
  if (!status.ready) throw new Error('Google Ads not ready — connect OAuth and set customer ID');

  const accessToken = await getAccessToken(env, prefs);
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN || prefs.developer_token;
  const customerId = status.customerId;
  const url = `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
  };
  if (status.loginCustomerId) headers['login-customer-id'] = status.loginCustomerId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = null; }
  if (!res.ok) {
    const detail =
      data?.error?.details?.[0]?.errors?.[0]?.message ||
      data?.[0]?.error?.details?.[0]?.errors?.[0]?.message ||
      '';
    let msg = detail || data?.error?.message || data?.[0]?.error?.message || '';
    if (!msg && /<!DOCTYPE html|/i.test(text)) {
      msg = `Google Ads API ${ADS_API_VERSION} returned HTTP ${res.status} (endpoint missing — API version may be sunset)`;
    }
    if (!msg) msg = text.slice(0, 280) || `HTTP ${res.status}`;
    // Wrong login-customer-id often surfaces as a misleading "missing OAuth" 401
    if (/missing required authentication credential/i.test(msg) && status.loginCustomerId) {
      msg += ' — often a bad Login customer ID (MCC). Clear it and retry, or use the real 10-digit manager ID.';
    }
    throw new Error(msg);
  }

  // searchStream returns an array of { results: [...] } chunks
  const rows = [];
  const chunks = Array.isArray(data) ? data : (data?.results ? [data] : []);
  for (const chunk of chunks) {
    for (const row of (chunk.results || [])) rows.push(row);
  }
  return rows;
}

const REPORTS = [
  {
    type: 'search_terms',
    query: `
      SELECT
        search_term_view.search_term,
        campaign.name,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
      LIMIT 800
    `,
    map: (r) => ({
      'Search term': r.searchTermView?.searchTerm || '',
      Campaign: r.campaign?.name || '',
      'Ad group': r.adGroup?.name || '',
      'Impr.': r.metrics?.impressions ?? '',
      Clicks: r.metrics?.clicks ?? '',
      CTR: r.metrics?.ctr != null ? `${(Number(r.metrics.ctr) * 100).toFixed(2)}%` : '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '',
    }),
  },
  {
    type: 'campaigns',
    query: `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.impressions DESC
      LIMIT 200
    `,
    fallbackQuery: `
      SELECT campaign.id, campaign.name, campaign.status
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
      LIMIT 200
    `,
    map: (r) => ({
      Campaign: r.campaign?.name || '',
      Status: r.campaign?.status || '',
      'Impr.': r.metrics?.impressions ?? '0',
      Clicks: r.metrics?.clicks ?? '0',
      CTR: r.metrics?.ctr != null ? `${(Number(r.metrics.ctr) * 100).toFixed(2)}%` : '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '0',
    }),
  },
  {
    type: 'keywords',
    query: `
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        campaign.name,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions,
        ad_group_criterion.quality_info.quality_score
      FROM keyword_view
      WHERE segments.date DURING LAST_30_DAYS
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.impressions DESC
      LIMIT 500
    `,
    map: (r) => ({
      Keyword: r.adGroupCriterion?.keyword?.text || '',
      'Match type': r.adGroupCriterion?.keyword?.matchType || '',
      Campaign: r.campaign?.name || '',
      'Ad group': r.adGroup?.name || '',
      'Impr.': r.metrics?.impressions ?? '',
      Clicks: r.metrics?.clicks ?? '',
      'Avg. CPC': microsToMoney(r.metrics?.averageCpc),
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '',
      'Quality score': r.adGroupCriterion?.qualityInfo?.qualityScore ?? '',
    }),
  },
  {
    type: 'geo',
    query: `
      SELECT
        geographic_view.country_criterion_id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM geographic_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
      LIMIT 300
    `,
    map: (r) => ({
      'Country criterion ID': r.geographicView?.countryCriterionId || '',
      Campaign: r.campaign?.name || '',
      'Impr.': r.metrics?.impressions ?? '',
      Clicks: r.metrics?.clicks ?? '',
      Cost: microsToMoney(r.metrics?.costMicros),
      Conversions: r.metrics?.conversions ?? '',
    }),
  },
];

function microsToMoney(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (n / 1e6).toFixed(2);
}

export async function syncGoogleAdsReports(env, prefs, { replace = true } = {}) {
  const status = googleAdsConfigStatus(env, prefs);
  if (!status.ready) {
    throw new Error('Not connected. Set customer ID, developer token, OAuth client, then Authorize.');
  }

  if (replace) {
    await env.phobiafree_db.prepare('DELETE FROM ads_rows').run();
    await env.phobiafree_db.prepare('DELETE FROM ads_imports').run();
  }

  const summary = [];
  for (const report of REPORTS) {
    let apiRows = await searchStream(env, prefs, report.query);
    if (!apiRows.length && report.fallbackQuery) {
      apiRows = await searchStream(env, prefs, report.fallbackQuery);
    }
    const mapped = apiRows.map(report.map).filter((row) => Object.values(row).some((v) => v !== '' && v != null));
    const ins = await env.phobiafree_db.prepare(`
      INSERT INTO ads_imports (report_type, filename, row_count, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(report.type, `google-ads-api:${report.type}`, mapped.length).run();
    const importId = ins.meta?.last_row_id;
    for (const row of mapped) {
      await env.phobiafree_db.prepare(`
        INSERT INTO ads_rows (import_id, report_type, data_json, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(importId, report.type, JSON.stringify(row)).run();
    }
    summary.push({ type: report.type, rows: mapped.length });
  }

  const when = new Date().toISOString();
  await saveGoogleAdsPref(env, 'last_sync', when);
  await saveGoogleAdsPref(env, 'last_error', '');
  return { ok: true, synced_at: when, reports: summary };
}
