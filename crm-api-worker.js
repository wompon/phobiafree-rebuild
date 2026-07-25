/**
 * CRM admin API — replaces visitor_log.php ajax + data loading.
 */
import {
  setRequestOrigin, json, requireAuth,
} from './lib/admin-auth.js';
import { gcalCreateEvent, gcalDeleteEvent } from './lib/gcal.js';
import {
  getHoursWindows,
  setHoursWindows,
  getSessionPriceCents,
  setSessionPriceCents,
  formatHoursLabel,
} from './lib/settings.js';
import { loadArkBundle, handleArkAction } from './lib/ark.js';
import {
  loadGoogleAdsPrefs,
  exchangeGoogleAdsCode,
  saveGoogleAdsPref,
} from './lib/google-ads.js';

export default {
  async fetch(request, env) {
    setRequestOrigin(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: json({}).headers });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/crm/dashboard' && request.method === 'GET') {
        return await handleDashboard(request, env);
      }
      if (url.pathname === '/api/crm/action' && request.method === 'POST') {
        return await handleAction(request, env);
      }
      if (url.pathname === '/api/crm/google-ads/callback' && request.method === 'GET') {
        return await handleGoogleAdsOAuthCallback(request, env);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

async function handleDashboard(request, env) {
  if (!(await requireAuth(request, env))) return json({ error: 'unauthorized' }, 401);

  const { results: consultations } = await env.phobiafree_db
    .prepare('SELECT * FROM consultations ORDER BY appointment_dt DESC')
    .all();
  const { results: payments } = await env.phobiafree_db
    .prepare('SELECT * FROM payment_links ORDER BY created_at DESC')
    .all();
  const { results: blocked } = await env.phobiafree_db
    .prepare("SELECT blocked_dt FROM blocked_slots WHERE blocked_dt >= datetime('now','-1 day') ORDER BY blocked_dt ASC")
    .all();
  const { results: sessions } = await env.phobiafree_db
    .prepare('SELECT * FROM therapy_sessions ORDER BY session_dt DESC')
    .all();
  const { results: visitorLogs } = await env.phobiafree_db
    .prepare('SELECT * FROM visitor_log ORDER BY last_seen DESC LIMIT 500')
    .all();
  let pageHits = [];
  try {
    const hits = await env.phobiafree_db
      .prepare('SELECT * FROM page_hits ORDER BY created_at DESC LIMIT 500')
      .all();
    pageHits = hits.results || [];
  } catch (e) {
    pageHits = [];
  }

  await ensureEvolveSchema(env);
  const { results: evolveGenes } = await env.phobiafree_db
    .prepare('SELECT * FROM evolve_genes ORDER BY sort_order ASC, id ASC')
    .all();
  const { results: evolveIdeaRows } = await env.phobiafree_db
    .prepare(`SELECT * FROM evolve_ideas ORDER BY CASE status
      WHEN 'queued' THEN 0 WHEN 'allowed' THEN 1 WHEN 'inbox' THEN 2
      WHEN 'doing' THEN 3 WHEN 'blocked' THEN 4 ELSE 5 END, id DESC LIMIT 300`)
    .all();
  const evolveIdeas = (evolveIdeaRows || []).map((row) => {
    let chat = [];
    try {
      const parsed = row.chat_json ? JSON.parse(row.chat_json) : [];
      chat = Array.isArray(parsed) ? parsed : [];
    } catch (_) { chat = []; }
    let agentId = row.agent_id || '';
    if (!agentId && row.run_note) {
      const m = String(row.run_note).match(/\b(bc-[0-9a-f-]{20,})\b/i);
      if (m) agentId = m[1];
    }
    return { ...row, chat, agent_id: agentId || row.agent_id || null };
  });
  let ark = {
    adsPanels: ['overview', 'search_terms', 'campaigns', 'hotlinks'],
    adsPanelCatalog: [],
    adsImports: [],
    adsRows: [],
    semrushImports: [],
    semrushKeywords: [],
    semrushFilters: {},
    cursorCloudReady: false,
  };
  try {
    ark = await loadArkBundle(env);
  } catch (e) {
    console.error('ark bundle failed', e);
  }

  const today = new Date().toISOString().slice(0, 10);
  let totalRevenue = 0;
  let pendingCount = 0;
  let todayCount = 0;
  let weekCount = 0;
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStartTs = weekStart.setHours(0, 0, 0, 0);
  const weekEndTs = weekStartTs + 7 * 24 * 60 * 60 * 1000;

  for (const p of payments) {
    if (p.paid) totalRevenue += p.amount_cents;
  }
  for (const c of consultations) {
    if ((c.status || 'pending') === 'pending') pendingCount++;
    if ((c.appointment_dt || '').startsWith(today)) todayCount++;
    const t = new Date((c.appointment_dt || '').replace(' ', 'T')).getTime();
    if (t >= weekStartTs && t < weekEndTs) weekCount++;
  }

  const hoursWindows = await getHoursWindows(env);
  const sessionPriceCents = await getSessionPriceCents(env);

  return json({
    consultations,
    payments,
    blocked_slots: blocked.map(r => r.blocked_dt),
    sessions,
    visitorLogs,
    pageHits,
    evolveGenes: evolveGenes || [],
    evolveIdeas: evolveIdeas || [],
    ark,
    hours_windows: hoursWindows,
    hours_label: formatHoursLabel(hoursWindows),
    session_price_cents: sessionPriceCents,
    stats: {
      todayCount,
      weekCount,
      totalClients: consultations.length,
      totalRevenue,
      pendingCount,
    },
  });
}

async function handleGoogleAdsOAuthCallback(request, env) {
  const url = new URL(request.url);
  const err = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const origin = 'https://phobiafree.life';
  if (err) {
    await saveGoogleAdsPref(env, 'last_error', err);
    return Response.redirect(`${origin}/admin?ads=oauth_error`, 302);
  }
  if (!code) {
    return Response.redirect(`${origin}/admin?ads=oauth_missing`, 302);
  }
  try {
    const prefs = await loadGoogleAdsPrefs(env);
    // Must match authorize URL redirect_uri exactly (and Cloud allowlist).
    const redirectUri = 'https://phobiafree.life/api/crm/google-ads/callback';
    await exchangeGoogleAdsCode(env, prefs, code, redirectUri);
    return Response.redirect(`${origin}/admin?ads=connected`, 302);
  } catch (e) {
    await saveGoogleAdsPref(env, 'last_error', String(e.message || e).slice(0, 500));
    return Response.redirect(`${origin}/admin?ads=oauth_fail`, 302);
  }
}

async function handleAction(request, env) {
  if (!(await requireAuth(request, env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const action = (body.ajax_action || body.action || '').toString();

  const arkResult = await handleArkAction(body, env);
  if (arkResult) {
    if (arkResult.error) return json({ error: arkResult.error }, arkResult.status || 400);
    return json(arkResult);
  }

  switch (action) {
    case 'block_slot': {
      const dt = (body.datetime || '').toString().slice(0, 19);
      const reason = (body.reason || 'Blocked by admin').toString().slice(0, 255);
      await env.phobiafree_db
        .prepare('INSERT OR IGNORE INTO blocked_slots (blocked_dt, reason) VALUES (?, ?)')
        .bind(dt, reason).run();
      return json({ success: true });
    }
    case 'unblock_slot': {
      const dt = (body.datetime || '').toString().slice(0, 19);
      await env.phobiafree_db
        .prepare('DELETE FROM blocked_slots WHERE blocked_dt = ?')
        .bind(dt).run();
      return json({ success: true });
    }
    case 'update_status': {
      const id = parseInt(body.id, 10);
      const status = (body.status || '').toString().slice(0, 50);
      await env.phobiafree_db
        .prepare('UPDATE consultations SET status = ? WHERE id = ?')
        .bind(status, id).run();
      return json({ success: true });
    }
    case 'delete_consultation': {
      const id = parseInt(body.id, 10);
      const row = await env.phobiafree_db
        .prepare('SELECT google_event_id FROM consultations WHERE id = ?')
        .bind(id).first();
      if (row?.google_event_id) await gcalDeleteEvent(env, row.google_event_id);
      await env.phobiafree_db.prepare('DELETE FROM consultations WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
    case 'gen_payment': {
      const name = (body.name || '').toString().trim();
      const email = (body.email || '').toString().trim();
      const linkType = normalizeLinkType(body.link_type || body.type);
      // UI Pay Link passes therapy_sessions.id as session_id — resolve to
      // consultations.id before insert (payment_links.consultation_id has FK).
      const therapySessionId = parseInt(body.session_id, 10) || null;
      let consultationId = parseInt(body.consultation_id, 10) || null;
      if (!consultationId && therapySessionId) {
        const sess = await env.phobiafree_db
          .prepare('SELECT consultation_id FROM therapy_sessions WHERE id = ?')
          .bind(therapySessionId).first();
        consultationId = sess?.consultation_id
          ? parseInt(sess.consultation_id, 10) || null
          : null;
      }
      if (consultationId) {
        const exists = await env.phobiafree_db
          .prepare('SELECT id FROM consultations WHERE id = ?')
          .bind(consultationId).first();
        if (!exists) consultationId = null;
      }
      const meta = linkTypeMeta(linkType);
      let amount;
      if (meta.isDonation) {
        amount = 0;
      } else if (body.amount_cents) {
        amount = parseInt(body.amount_cents, 10);
      } else if (linkType === 'urgent') {
        amount = 47900;
      } else {
        amount = await getSessionPriceCents(env);
      }
      if (!meta.isDonation && (!amount || amount < 50)) {
        return json({ error: 'Invalid amount' }, 400);
      }
      const priceReason = ((body.price_reason || body.invoice_note || '').toString().trim().slice(0, 500) || null);
      const externalPayUrl = ((body.external_pay_url || body.pay_url || '').toString().trim().slice(0, 1000) || null);
      if (externalPayUrl && !/^https?:\/\//i.test(externalPayUrl)) {
        return json({ error: 'Pay URL must start with http(s)://' }, 400);
      }
      const desc = meta.description;
      const token = hexToken(32);
      const inserted = await env.phobiafree_db.prepare(`
        INSERT INTO payment_links (token, consultation_id, client_name, client_email, amount_cents, description, link_type, price_reason, external_pay_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(token, consultationId, name, email, amount, desc, linkType, priceReason, externalPayUrl).run();
      const siteUrl = env.SITE_URL || 'https://phobiafree.life';
      const link = `${siteUrl}/payment.html?token=${token}`;
      try {
        const amountLine = meta.isDonation
          ? 'You may choose any donation amount on the page.'
          : (`Amount: $${(amount / 100).toFixed(2)}` + (priceReason ? `\nNote: ${priceReason}` : ''));
        await sendEmail(env, email,
          meta.isDonation
            ? 'Your PhobiaFree.life Donation Link'
            : 'Your PhobiaFree.life Session Payment Link',
          `Dear ${name},\n\n${meta.emailIntro}\n\n${link}\n\n${amountLine}\n\nSteven Shaw\nPhobiaFree.life\n`);
      } catch {}
      return json({
        success: true,
        link,
        token,
        amount_cents: amount,
        link_type: linkType,
        price_reason: priceReason,
        external_pay_url: externalPayUrl,
        id: inserted.meta?.last_row_id || null,
      });
    }
    case 'mark_payment_paid': {
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: 'Missing id' }, 400);
      await env.phobiafree_db.prepare(`
        UPDATE payment_links
        SET paid = 1, used = 1, paid_at = datetime('now')
        WHERE id = ? AND paid = 0
      `).bind(id).run();
      return json({ success: true });
    }
    case 'delete_payment': {
      const id = parseInt(body.id, 10);
      const row = await env.phobiafree_db
        .prepare('SELECT paid FROM payment_links WHERE id = ?')
        .bind(id).first();
      if (!row) return json({ error: 'Payment not found' }, 404);
      if (row.paid) return json({ error: 'Paid links cannot be deleted' }, 400);
      await env.phobiafree_db.prepare('DELETE FROM payment_links WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
    case 'delete_visitor': {
      const vid = (body.vid || '').toString().replace(/[^a-z0-9_]/gi, '');
      if (!vid) return json({ error: 'Missing vid' }, 400);
      await env.phobiafree_db.prepare('DELETE FROM session_snapshots WHERE vid = ?').bind(vid).run();
      await env.phobiafree_db.prepare('DELETE FROM visitor_log WHERE vid = ?').bind(vid).run();
      await env.phobiafree_db.prepare('DELETE FROM live_visitors WHERE vid = ?').bind(vid).run();
      return json({ success: true });
    }
    case 'get_hours': {
      const windows = await getHoursWindows(env);
      return json({ success: true, hours_windows: windows, hours_label: formatHoursLabel(windows) });
    }
    case 'save_hours': {
      const windows = await setHoursWindows(env, body.hours_windows || body.windows || []);
      return json({ success: true, hours_windows: windows, hours_label: formatHoursLabel(windows) });
    }
    case 'save_price': {
      const cents = await setSessionPriceCents(env, body.amount_cents ?? body.price_cents);
      return json({ success: true, session_price_cents: cents });
    }
    case 'add_session': {
      const consultId = parseInt(body.consultation_id, 10) || null;
      const name = (body.client_name || '').toString();
      const email = (body.client_email || '').toString();
      const phone = (body.client_phone || '').toString();
      const sessionDt = (body.session_dt || '').toString().slice(0, 19);
      const zoomLink = (body.zoom_link || '').toString();
      const notes = (body.notes || '').toString();
      let gcalId = null;
      try {
        gcalId = await gcalCreateEvent(
          env,
          `PhobiaFree Therapy: ${name}`,
          `Email: ${email}\nPhone: ${phone}\nZoom: ${zoomLink}\nNotes: ${notes}`,
          sessionDt,
          60
        );
      } catch {}
      await env.phobiafree_db.prepare(`
        INSERT INTO therapy_sessions (consultation_id, client_name, client_email, client_phone, session_dt, zoom_link, notes, gcal_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(consultId, name, email, phone, sessionDt, zoomLink, notes, gcalId || '').run();
      return json({ success: true });
    }
    case 'delete_session': {
      const id = parseInt(body.id, 10);
      const row = await env.phobiafree_db
        .prepare('SELECT gcal_event_id FROM therapy_sessions WHERE id = ?')
        .bind(id).first();
      if (row?.gcal_event_id) await gcalDeleteEvent(env, row.gcal_event_id);
      await env.phobiafree_db.prepare('DELETE FROM therapy_sessions WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
    case 'update_session_status': {
      const id = parseInt(body.id, 10);
      const status = (body.status || '').toString().slice(0, 50);
      if (status === 'cancelled') {
        const row = await env.phobiafree_db
          .prepare('SELECT gcal_event_id FROM therapy_sessions WHERE id = ?')
          .bind(id).first();
        if (row?.gcal_event_id) await gcalDeleteEvent(env, row.gcal_event_id);
      }
      await env.phobiafree_db
        .prepare('UPDATE therapy_sessions SET status = ? WHERE id = ?')
        .bind(status, id).run();
      return json({ success: true });
    }
    case 'clear_visitor_log': {
      await env.phobiafree_db.prepare('DELETE FROM session_snapshots').run();
      await env.phobiafree_db.prepare('DELETE FROM visitor_log').run();
      await env.phobiafree_db.prepare('DELETE FROM live_visitors').run();
      return json({ success: true });
    }
    case 'add_evolve_idea': {
      await ensureEvolveSchema(env);
      const bodyText = (body.body || body.idea || '').toString().trim();
      if (!bodyText) return json({ error: 'Idea text required' }, 400);
      const domain = normalizeEvolveDomain(body.domain);
      const inserted = await env.phobiafree_db.prepare(`
        INSERT INTO evolve_ideas (domain, body, status, created_at, updated_at)
        VALUES (?, ?, 'inbox', datetime('now'), datetime('now'))
      `).bind(domain, bodyText.slice(0, 8000)).run();
      return json({ success: true, id: inserted.meta?.last_row_id || null });
    }
    case 'update_evolve_idea': {
      await ensureEvolveSchema(env);
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: 'Missing id' }, 400);
      const status = normalizeEvolveStatus(body.status);
      const resultNote = body.result != null ? String(body.result).trim().slice(0, 4000) : null;
      const domain = body.domain != null ? normalizeEvolveDomain(body.domain) : null;
      const ideaBody = body.body != null ? String(body.body).trim().slice(0, 8000) : null;
      if (ideaBody !== null) {
        await env.phobiafree_db
          .prepare("UPDATE evolve_ideas SET body = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(ideaBody, id).run();
      }
      if (domain) {
        await env.phobiafree_db
          .prepare("UPDATE evolve_ideas SET domain = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(domain, id).run();
      }
      if (body.status != null) {
        await env.phobiafree_db
          .prepare("UPDATE evolve_ideas SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(status, id).run();
      }
      if (resultNote !== null) {
        await env.phobiafree_db
          .prepare("UPDATE evolve_ideas SET result = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(resultNote, id).run();
      }
      return json({ success: true });
    }
    case 'delete_evolve_idea': {
      await ensureEvolveSchema(env);
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: 'Missing id' }, 400);
      await env.phobiafree_db.prepare('DELETE FROM evolve_ideas WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
    case 'add_evolve_gene': {
      await ensureEvolveSchema(env);
      const title = (body.title || '').toString().trim().slice(0, 200);
      const rule = (body.rule || body.body || '').toString().trim().slice(0, 4000);
      if (!title || !rule) return json({ error: 'Title and rule required' }, 400);
      const inserted = await env.phobiafree_db.prepare(`
        INSERT INTO evolve_genes (title, rule, active, sort_order, created_at, updated_at)
        VALUES (?, ?, 1, 100, datetime('now'), datetime('now'))
      `).bind(title, rule).run();
      return json({ success: true, id: inserted.meta?.last_row_id || null });
    }
    case 'update_evolve_gene': {
      await ensureEvolveSchema(env);
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: 'Missing id' }, 400);
      if (body.active != null) {
        await env.phobiafree_db
          .prepare("UPDATE evolve_genes SET active = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(body.active ? 1 : 0, id).run();
      }
      if (body.title != null || body.rule != null) {
        const row = await env.phobiafree_db.prepare('SELECT title, rule FROM evolve_genes WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Not found' }, 404);
        const title = body.title != null ? String(body.title).trim().slice(0, 200) : row.title;
        const rule = body.rule != null ? String(body.rule).trim().slice(0, 4000) : row.rule;
        await env.phobiafree_db
          .prepare("UPDATE evolve_genes SET title = ?, rule = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(title, rule, id).run();
      }
      return json({ success: true });
    }
    case 'delete_evolve_gene': {
      await ensureEvolveSchema(env);
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: 'Missing id' }, 400);
      await env.phobiafree_db.prepare('DELETE FROM evolve_genes WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
    default:
      return json({ error: 'Unknown action' }, 400);
  }
}

function normalizeEvolveDomain(raw) {
  const t = String(raw || 'general').toLowerCase().trim();
  if (['ads', 'semrush', 'site', 'payments', 'visitors', 'general'].includes(t)) return t;
  return 'general';
}

function normalizeEvolveStatus(raw) {
  const t = String(raw || 'inbox').toLowerCase().trim();
  if (['inbox', 'allowed', 'queued', 'doing', 'done', 'blocked'].includes(t)) return t;
  return 'inbox';
}

async function ensureEvolveSchema(env) {
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS evolve_genes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      rule TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 100,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS evolve_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT DEFAULT 'general',
      body TEXT NOT NULL,
      status TEXT DEFAULT 'inbox',
      result TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  for (const sql of [
    'ALTER TABLE evolve_ideas ADD COLUMN allowed INTEGER DEFAULT 0',
    'ALTER TABLE evolve_ideas ADD COLUMN agent_prompt TEXT',
    'ALTER TABLE evolve_ideas ADD COLUMN run_note TEXT',
    'ALTER TABLE evolve_ideas ADD COLUMN agent_id TEXT',
    'ALTER TABLE evolve_ideas ADD COLUMN run_id TEXT',
    'ALTER TABLE evolve_ideas ADD COLUMN chat_json TEXT',
  ]) {
    try { await env.phobiafree_db.prepare(sql).run(); } catch (_) { /* exists */ }
  }
  const count = await env.phobiafree_db.prepare('SELECT COUNT(*) AS c FROM evolve_genes').first();
  if (!count || !count.c) {
    const seeds = [
      ['Think → queue → implement → measure', 'Ideas enter Evolve inbox. Agents implement. You analyze results and mutate genes — not grind UI jungles.'],
      ['Ads: intent only', 'Exact positives from approved SEMrush list only. Shared negatives for junk themes (tips, medication, classes, free, reddit, quiz…).'],
      ['Ads: track before spend', 'Final URLs must carry utm_source/utm_campaign/utm_term (and gclid). Reconcile with page_hits including ghost (no mouse) loads.'],
      ['Ads: geo evolution', 'Start with few geo buckets; split by CPC/volume data — not one campaign per house.'],
      ['Close variants are law', 'Google Exact is exact-ish. Fight with negatives + specificity, not rage. Pause spend when learning.'],
      ['Site changes from ideas', 'Public site / pricing / copy changes should come from Evolve ideas when possible, so thinking stays the input.'],
    ];
    let order = 10;
    for (const [title, rule] of seeds) {
      await env.phobiafree_db.prepare(`
        INSERT INTO evolve_genes (title, rule, active, sort_order, created_at, updated_at)
        VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
      `).bind(title, rule, order).run();
      order += 10;
    }
  }
}

function normalizeLinkType(raw) {
  const t = String(raw || 'standard').toLowerCase().trim();
  if (t === 'review' || t === 'veteran' || t === 'senior' || t === 'standard' || t === 'urgent') return t;
  return 'standard';
}

function linkTypeMeta(type) {
  switch (type) {
    case 'review':
      return {
        isDonation: true,
        description: 'Donation — Honest review',
        emailIntro: 'Thank you for your honest review. You are so appreciated! Please use this secure link to leave a donation of any amount:',
      };
    case 'veteran':
      return {
        isDonation: true,
        description: 'Donation — Veteran',
        emailIntro: 'Thank you for your service! Please use this secure link to leave a donation of any amount:',
      };
    case 'senior':
      return {
        isDonation: true,
        description: 'Donation — Senior',
        emailIntro: 'Please use this secure link to leave a kind donation of any amount:',
      };
    case 'urgent':
      return {
        isDonation: false,
        description: 'PhobiaFree — Urgent Session',
        emailIntro: 'Thank you for your consultation. Please use this secure link to complete payment:',
      };
    default:
      return {
        isDonation: false,
        description: 'PhobiaFree — Single Session',
        emailIntro: 'Thank you for your consultation. Please use this secure link to complete payment:',
      };
  }
}

function hexToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendEmail(env, to, subject, bodyText, replyTo = '') {
  if (!to) return false;
  if (!env.EMAIL || typeof env.EMAIL.send !== 'function') {
    console.error('sendEmail: EMAIL binding not configured');
    return false;
  }

  try {
    const payload = {
      to,
      from: { email: 'bookings@phobiafree.life', name: 'PhobiaFree.life' },
      subject,
      text: bodyText,
      html: '<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">' +
        String(bodyText)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;') +
        '</pre>',
    };
    if (replyTo) payload.replyTo = replyTo;
    await env.EMAIL.send(payload);
    return true;
  } catch (err) {
    console.error('CF EMAIL.send failed:', err && err.message ? err.message : err);
    return false;
  }
}
