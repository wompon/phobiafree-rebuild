import {
  googleAdsConfigStatus,
  loadGoogleAdsPrefs,
  saveGoogleAdsPref,
  buildGoogleAdsAuthUrl,
  exchangeGoogleAdsCode,
  syncGoogleAdsReports,
  listAccessibleGoogleAdsAccounts,
  normalizeCustomerId,
  normalizeOAuthClientId,
  normalizeOAuthClientSecret,
  GOOGLE_ADS_REDIRECT_URI,
} from './google-ads.js';
import {
  loadSemrushPrefs,
  saveSemrushPref,
  semrushConfigStatus,
  syncSemrushReports,
  normalizeSemrushDomain,
  normalizeApiKey,
  parseSyncSets,
} from './semrush.js';

/**
 * Ark animals: Thoughts (Allow/Run), Google Ads command center, SEMrush cruncher.
 * Starter layer — live Google Ads / Semrush sync when connected; CSV still available as backup.
 */

export async function ensureArkSchema(env) {
  await ensureEvolveExtras(env);
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS ark_prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS ads_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      filename TEXT,
      row_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS ads_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      report_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS semrush_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      row_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS semrush_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER,
      keyword TEXT NOT NULL,
      volume INTEGER,
      kd REAL,
      cpc REAL,
      competition REAL,
      intent TEXT,
      url TEXT,
      keep INTEGER DEFAULT 0,
      negative INTEGER DEFAULT 0,
      data_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function ensureEvolveExtras(env) {
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
  // Best-effort column adds (SQLite ignores if already present via try/catch)
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
}

export async function loadArkBundle(env) {
  await ensureArkSchema(env);

  const panelsRaw = await getPref(env, 'ads_panels', '["overview","search_terms","campaigns","hotlinks"]');
  let adsPanels = [];
  try { adsPanels = JSON.parse(panelsRaw); } catch (_) { adsPanels = ['overview', 'search_terms', 'campaigns', 'hotlinks']; }

  const { results: adsImports } = await env.phobiafree_db
    .prepare('SELECT * FROM ads_imports ORDER BY id DESC LIMIT 20')
    .all();
  const { results: adsRows } = await env.phobiafree_db
    .prepare('SELECT id, import_id, report_type, data_json, created_at FROM ads_rows ORDER BY id DESC LIMIT 500')
    .all();

  const { results: semImports } = await env.phobiafree_db
    .prepare('SELECT * FROM semrush_imports ORDER BY id DESC LIMIT 20')
    .all();
  const { results: semKeywords } = await env.phobiafree_db
    .prepare('SELECT * FROM semrush_keywords ORDER BY id DESC LIMIT 2000')
    .all();

  const filtersRaw = await getPref(env, 'semrush_filters', JSON.stringify({
    minVolume: 50,
    maxKd: 60,
    maxCpc: 25,
    intentIncludes: '',
    excludeWords: 'tips,medication,class,course,free,reddit,quiz,near me',
  }));
  let semrushFilters = {};
  try { semrushFilters = JSON.parse(filtersRaw); } catch (_) { semrushFilters = {}; }

  const adsPrefs = await loadGoogleAdsPrefs(env);
  const adsStatus = googleAdsConfigStatus(env, adsPrefs);
  const semPrefs = await loadSemrushPrefs(env);
  const semStatus = semrushConfigStatus(env, semPrefs);
  const adminChat = await loadAdminChat(env);

  return {
    adsPanels,
    adsPanelCatalog: ADS_PANEL_CATALOG,
    adsImports: adsImports || [],
    adsRows: (adsRows || []).map(r => ({
      ...r,
      data: safeJson(r.data_json),
    })),
    semrushImports: semImports || [],
    semrushKeywords: semKeywords || [],
    semrushFilters,
    cursorCloudReady: !!(env.CURSOR_API_KEY),
    githubAutopilotReady: !!(env.CURSOR_API_KEY && env.CURSOR_GITHUB_REPO),
    adminChat,
    googleAds: {
      ...adsStatus,
      lastSync: adsPrefs.last_sync || null,
      lastError: adsPrefs.last_error || null,
      // never echo secrets back
      hasStoredClientSecret: !!(adsPrefs.client_secret || env.GOOGLE_ADS_CLIENT_SECRET),
      hasStoredDeveloperToken: !!(adsPrefs.developer_token || env.GOOGLE_ADS_DEVELOPER_TOKEN),
    },
    semrush: {
      hasApiKey: semStatus.hasApiKey,
      apiKeyHint: semStatus.apiKeyHint,
      fromWorkerSecret: semStatus.fromWorkerSecret,
      domain: semStatus.domain,
      database: semStatus.database,
      syncSets: semStatus.syncSets,
      dailySync: semStatus.dailySync,
      displayLimit: semStatus.displayLimit,
      ready: semStatus.ready,
      lastSync: semStatus.lastSync,
      lastError: semStatus.lastError,
      overview: semStatus.overview,
      competitors: semStatus.competitors,
      lastResult: semStatus.lastResult,
      missing: semStatus.missing,
    },
  };
}

export async function handleArkAction(body, env) {
  const action = (body.ajax_action || body.action || '').toString();
  if (!ARK_ACTIONS.has(action)) return null;

  await ensureArkSchema(env);

  switch (action) {
    case 'allow_evolve_idea': {
      const id = parseInt(body.id, 10);
      if (!id) return { error: 'Missing id', status: 400 };
      await env.phobiafree_db.prepare(`
        UPDATE evolve_ideas SET allowed = 1, status = 'allowed', updated_at = datetime('now') WHERE id = ?
      `).bind(id).run();
      return { success: true };
    }
    case 'run_evolve_idea': {
      const id = parseInt(body.id, 10);
      if (!id) return { error: 'Missing id', status: 400 };
      const idea = await env.phobiafree_db.prepare('SELECT * FROM evolve_ideas WHERE id = ?').bind(id).first();
      if (!idea) return { error: 'Not found', status: 404 };
      const { results: genes } = await env.phobiafree_db
        .prepare('SELECT title, rule FROM evolve_genes WHERE active = 1 ORDER BY sort_order ASC, id ASC')
        .all();
      const prompt = await buildAgentPrompt(env, idea, genes || []);
      const seedChat = appendChat(parseChat(idea.chat_json), {
        role: 'agent',
        kind: 'status',
        text: 'Starting Cursor agent…',
      });
      await env.phobiafree_db.prepare(`
        UPDATE evolve_ideas
        SET allowed = 1, status = 'queued', agent_prompt = ?, run_note = '', chat_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(prompt, JSON.stringify(seedChat), id).run();

      const cloud = await tryCursorCloud(env, prompt, idea);
      if (cloud.ok) {
        const chat = appendChat(seedChat, {
          role: 'agent',
          kind: 'status',
          text: `Cursor agent online. Reply in this chatbox to send follow-ups.`,
          agentId: cloud.agentId || '',
          runId: cloud.runId || '',
        });
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas
          SET status = 'doing', run_note = ?, agent_id = ?, run_id = ?, chat_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          cloud.note || 'Cloud agent started',
          cloud.agentId || null,
          cloud.runId || null,
          JSON.stringify(chat),
          id
        ).run();
      } else if (cloud.attempted) {
        const chat = appendChat(seedChat, {
          role: 'agent',
          kind: 'error',
          text: cloud.note || 'Cloud dispatch failed',
        });
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas SET run_note = ?, chat_json = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(cloud.note || 'Cloud dispatch failed', JSON.stringify(chat), id).run();
      } else {
        const chat = appendChat(seedChat, {
          role: 'agent',
          kind: 'status',
          text: cloud.note || 'Queued — waiting for agent runner',
        });
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas SET run_note = ?, chat_json = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(cloud.note || 'Queued — waiting for agent runner', JSON.stringify(chat), id).run();
      }
      return {
        success: true,
        prompt,
        cloud,
        status: cloud.ok ? 'doing' : 'queued',
        agentUrl: cloud.url || null,
        agentId: cloud.agentId || null,
      };
    }
    case 'chat_evolve_idea': {
      const id = parseInt(body.id, 10);
      const text = String(body.text || body.message || '').trim();
      if (!id) return { error: 'Missing id', status: 400 };
      if (!text) return { error: 'Write a reply first', status: 400 };
      if (text.length > 8000) return { error: 'Reply too long', status: 400 };
      const idea = await env.phobiafree_db.prepare('SELECT * FROM evolve_ideas WHERE id = ?').bind(id).first();
      if (!idea) return { error: 'Not found', status: 404 };
      const agentId = String(idea.agent_id || extractAgentId(idea.run_note) || '').trim();
      if (!agentId) return { error: 'No Cursor agent on this thought yet — hit Run first', status: 400 };

      let chat = appendChat(parseChat(idea.chat_json), {
        role: 'you',
        kind: 'followup',
        text,
      });
      const follow = await sendCursorFollowUp(env, agentId, text);
      if (!follow.ok) {
        chat = appendChat(chat, {
          role: 'agent',
          kind: 'error',
          text: follow.note || 'Follow-up failed',
        });
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas SET chat_json = ?, run_note = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(JSON.stringify(chat), follow.note || 'Follow-up failed', id).run();
        return { error: follow.note || 'Follow-up failed', status: follow.status || 502, chat };
      }

      chat = appendChat(chat, {
        role: 'agent',
        kind: 'status',
        text: 'Cursor received your reply — working…',
        runId: follow.runId || '',
      });
      await env.phobiafree_db.prepare(`
        UPDATE evolve_ideas
        SET status = 'doing', run_id = ?, chat_json = ?, run_note = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        follow.runId || idea.run_id || null,
        JSON.stringify(chat),
        follow.note || `Follow-up sent (${agentId})`,
        id
      ).run();
      return {
        success: true,
        agentId,
        runId: follow.runId || null,
        agentUrl: `https://cursor.com/agents/${encodeURIComponent(agentId)}`,
        chat,
      };
    }
    case 'sync_evolve_idea': {
      const id = parseInt(body.id, 10);
      if (!id) return { error: 'Missing id', status: 400 };
      const idea = await env.phobiafree_db.prepare('SELECT * FROM evolve_ideas WHERE id = ?').bind(id).first();
      if (!idea) return { error: 'Not found', status: 404 };
      const agentId = String(idea.agent_id || extractAgentId(idea.run_note) || '').trim();
      const runId = String(idea.run_id || '').trim();
      if (!agentId) return { success: true, synced: false, reason: 'no_agent' };

      const snap = await fetchCursorRun(env, agentId, runId);
      if (!snap.ok) {
        return { success: true, synced: false, reason: snap.note || 'lookup_failed' };
      }

      let chat = parseChat(idea.chat_json);
      let status = idea.status;
      let result = idea.result || '';
      let note = idea.run_note || '';
      let changed = false;
      const terminal = ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'];
      const runStatus = String(snap.run?.status || '').toUpperCase();

      if (snap.runId && snap.runId !== runId) {
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas SET run_id = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(snap.runId, id).run();
      }

      if (terminal.includes(runStatus)) {
        const reply = String(snap.run?.result || '').trim();
        const already = chat.some(m => m.role === 'agent' && m.kind === 'result' && m.runId === snap.runId);
        if (!already) {
          const label = runStatus === 'FINISHED'
            ? (reply || 'Agent finished.')
            : (reply || `Agent ${runStatus.toLowerCase()}.`);
          chat = appendChat(chat, {
            role: 'agent',
            kind: runStatus === 'FINISHED' ? 'result' : 'error',
            text: label,
            runId: snap.runId || '',
          });
          if (reply) result = reply.slice(0, 4000);
          const pr = snap.run?.git?.branches?.find(b => b?.prUrl)?.prUrl;
          note = [
            runStatus === 'FINISHED' ? 'Cloud agent finished' : `Cloud agent ${runStatus.toLowerCase()}`,
            snap.runId ? `(${snap.runId})` : '',
            pr || `https://cursor.com/agents/${encodeURIComponent(agentId)}`,
          ].filter(Boolean).join(' ').slice(0, 500);
          if (runStatus === 'FINISHED' && status === 'doing') status = 'done';
          changed = true;
        }
      } else if (idea.status === 'queued' || idea.status === 'doing') {
        // still running — keep doing
        status = 'doing';
      }

      if (changed) {
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas
          SET status = ?, result = ?, run_note = ?, chat_json = ?, run_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(status, result || null, note, JSON.stringify(chat), snap.runId || runId || null, id).run();
      }

      return {
        success: true,
        synced: changed,
        status,
        runStatus,
        agentId,
        runId: snap.runId || runId || null,
        chat,
        result,
      };
    }
    case 'admin_chat_send': {
      const text = String(body.text || body.message || '').trim();
      if (!text) return { error: 'Write a message first', status: 400 };
      if (text.length > 8000) return { error: 'Message too long', status: 400 };

      let state = await loadAdminChat(env);
      state.messages = appendChat(state.messages, {
        role: 'you',
        kind: 'message',
        text,
      });

      const genes = await env.phobiafree_db
        .prepare('SELECT title, rule FROM evolve_genes WHERE active = 1 ORDER BY sort_order ASC, id ASC')
        .all()
        .then((r) => r.results || [])
        .catch(() => []);

      if (!state.agentId) {
        const prompt = buildAdminChatPrompt(text, genes);
        const cloud = await tryCursorCloud(env, prompt, { id: 'chat' });
        if (!cloud.ok) {
          state.messages = appendChat(state.messages, {
            role: 'agent',
            kind: 'error',
            text: cloud.note || 'Could not start chat agent',
          });
          await saveAdminChat(env, state);
          return {
            error: cloud.note || 'Could not start chat agent',
            status: cloud.attempted ? 502 : 400,
            chat: state.messages,
          };
        }
        state.agentId = cloud.agentId || '';
        state.runId = cloud.runId || '';
        state.messages = appendChat(state.messages, {
          role: 'agent',
          kind: 'status',
          text: 'Thinking…',
          agentId: state.agentId,
          runId: state.runId,
        });
        await saveAdminChat(env, state);
        return {
          success: true,
          chat: state.messages,
          agentId: state.agentId,
          runId: state.runId,
        };
      }

      const follow = await sendCursorFollowUp(env, state.agentId, text);
      if (!follow.ok) {
        state.messages = appendChat(state.messages, {
          role: 'agent',
          kind: 'error',
          text: follow.note || 'Follow-up failed',
        });
        await saveAdminChat(env, state);
        return {
          error: follow.note || 'Follow-up failed',
          status: follow.status || 502,
          chat: state.messages,
          agentId: state.agentId,
          runId: state.runId,
        };
      }
      state.runId = follow.runId || state.runId || '';
      state.messages = appendChat(state.messages, {
        role: 'agent',
        kind: 'status',
        text: 'Thinking…',
        runId: state.runId,
      });
      await saveAdminChat(env, state);
      return {
        success: true,
        chat: state.messages,
        agentId: state.agentId,
        runId: state.runId,
      };
    }
    case 'admin_chat_sync': {
      let state = await loadAdminChat(env);
      if (!state.agentId) {
        return { success: true, synced: false, chat: state.messages, reason: 'no_agent' };
      }
      const prevRunId = state.runId;
      const snap = await fetchCursorRun(env, state.agentId, state.runId);
      if (!snap.ok) {
        return { success: true, synced: false, chat: state.messages, reason: snap.note || 'lookup_failed' };
      }
      if (snap.runId && snap.runId !== state.runId) state.runId = snap.runId;

      const terminal = ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'];
      const runStatus = String(snap.run?.status || '').toUpperCase();
      let changed = false;
      if (terminal.includes(runStatus)) {
        const reply = String(snap.run?.result || '').trim();
        const already = state.messages.some(
          (m) => m.role === 'agent' && (m.kind === 'result' || m.kind === 'error') && m.runId === snap.runId
        );
        if (!already) {
          state.messages = appendChat(state.messages, {
            role: 'agent',
            kind: runStatus === 'FINISHED' ? 'result' : 'error',
            text: reply || (runStatus === 'FINISHED' ? 'Done.' : `Agent ${runStatus.toLowerCase()}.`),
            runId: snap.runId || '',
          });
          changed = true;
        }
      }
      if (changed || state.runId !== prevRunId) {
        await saveAdminChat(env, state);
      }
      return {
        success: true,
        synced: changed,
        chat: state.messages,
        agentId: state.agentId,
        runId: state.runId,
        runStatus,
      };
    }
    case 'admin_chat_clear': {
      await saveAdminChat(env, { messages: [], agentId: '', runId: '' });
      return { success: true, chat: [] };
    }
    case 'poll_evolve_agents': {
      const { results } = await env.phobiafree_db
        .prepare(`SELECT id, agent_id, run_id, run_note, chat_json, status, result FROM evolve_ideas
          WHERE status IN ('doing','queued') ORDER BY id DESC LIMIT 40`)
        .all();
      let updated = 0;
      for (const idea of results || []) {
        const agentId = String(idea.agent_id || extractAgentId(idea.run_note) || '').trim();
        if (!agentId) continue;
        const snap = await fetchCursorRun(env, agentId, idea.run_id);
        if (!snap.ok || !snap.run) continue;
        const runStatus = String(snap.run?.status || '').toUpperCase();
        const terminal = ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'];
        if (!terminal.includes(runStatus)) {
          if (idea.status === 'queued') {
            await env.phobiafree_db.prepare(`
              UPDATE evolve_ideas SET status = 'doing', run_id = ?, updated_at = datetime('now') WHERE id = ?
            `).bind(snap.runId || idea.run_id || null, idea.id).run();
            updated += 1;
          } else if (snap.runId && snap.runId !== idea.run_id) {
            await env.phobiafree_db.prepare(`
              UPDATE evolve_ideas SET run_id = ?, updated_at = datetime('now') WHERE id = ?
            `).bind(snap.runId, idea.id).run();
          }
          continue;
        }
        let chat = parseChat(idea.chat_json);
        const reply = String(snap.run?.result || '').trim();
        const already = chat.some((m) => m.role === 'agent' && m.kind === 'result' && m.runId === snap.runId);
        if (!already) {
          chat = appendChat(chat, {
            role: 'agent',
            kind: runStatus === 'FINISHED' ? 'result' : 'error',
            text: reply || `Agent ${runStatus.toLowerCase()}.`,
            runId: snap.runId || '',
          });
        }
        const note = [
          runStatus === 'FINISHED' ? 'Cloud agent finished' : `Cloud agent ${runStatus.toLowerCase()}`,
          snap.runId ? `(${snap.runId})` : '',
          `https://cursor.com/agents/${encodeURIComponent(agentId)}`,
        ].filter(Boolean).join(' ').slice(0, 500);
        await env.phobiafree_db.prepare(`
          UPDATE evolve_ideas
          SET status = ?, result = ?, run_note = ?, chat_json = ?, run_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          runStatus === 'FINISHED' ? 'done' : 'blocked',
          reply ? reply.slice(0, 4000) : (idea.result || null),
          note,
          JSON.stringify(chat),
          snap.runId || idea.run_id || null,
          idea.id
        ).run();
        updated += 1;
      }
      return { success: true, updated };
    }
    case 'set_ads_panels': {
      const panels = Array.isArray(body.panels) ? body.panels.map(String).slice(0, 40) : [];
      const valid = new Set(ADS_PANEL_CATALOG.map(p => p.key));
      const clean = panels.filter(k => valid.has(k));
      await setPref(env, 'ads_panels', JSON.stringify(clean));
      return { success: true, panels: clean };
    }
    case 'import_ads_csv': {
      const filename = String(body.filename || 'upload.csv').slice(0, 200);
      let reportType = String(body.report_type || '').slice(0, 60);
      let rows = [];
      if (Array.isArray(body.rows) && body.rows.length) {
        rows = body.rows.slice(0, 2000).map((r) => (r && typeof r === 'object' ? r : {})).filter(r => Object.keys(r).length);
      } else {
        const csv = String(body.csv || '');
        if (!csv.trim()) return { error: 'Empty CSV', status: 400 };
        const parsed = parseGoogleAdsCsv(csv);
        rows = parsed.rows.slice(0, 2000);
        if (!reportType || reportType === 'auto') reportType = parsed.detectedType;
      }
      if (!reportType || reportType === 'auto') {
        const headers = rows[0] ? Object.keys(rows[0]) : [];
        reportType = detectAdsReportType(headers);
      }
      if (!rows.length) {
        return {
          error: 'No data rows found. Google Ads CSVs often have title lines on top — re-export as CSV, or paste the file and try again.',
          status: 400,
        };
      }
      const ins = await env.phobiafree_db.prepare(`
        INSERT INTO ads_imports (report_type, filename, row_count, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(reportType, filename, rows.length).run();
      const importId = ins.meta?.last_row_id;
      for (const row of rows) {
        await env.phobiafree_db.prepare(`
          INSERT INTO ads_rows (import_id, report_type, data_json, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(importId, reportType, JSON.stringify(row)).run();
      }
      return { success: true, import_id: importId, row_count: rows.length, report_type: reportType };
    }
    case 'clear_ads_data': {
      await env.phobiafree_db.prepare('DELETE FROM ads_rows').run();
      await env.phobiafree_db.prepare('DELETE FROM ads_imports').run();
      return { success: true };
    }
    case 'save_google_ads_settings': {
      if (body.customer_id != null) {
        await saveGoogleAdsPref(env, 'customer_id', normalizeCustomerId(body.customer_id));
      }
      if (body.login_customer_id != null) {
        const loginId = normalizeCustomerId(body.login_customer_id);
        // Reject pasted client-id fragments / nonsense (real Ads IDs are ~10 digits)
        if (loginId && (loginId.length < 6 || loginId.length > 12)) {
          return { error: 'Login customer ID (MCC) looks wrong — use the 10-digit manager ID, or leave blank', status: 400 };
        }
        await saveGoogleAdsPref(env, 'login_customer_id', loginId);
      }
      if (body.developer_token) {
        const dt = String(body.developer_token).trim();
        if (/^GOCSPX-/i.test(dt) || /\.apps\.googleusercontent\.com$/i.test(dt)) {
          return { error: 'That looks like an OAuth client secret/ID — developer token is the short token from Ads API Center', status: 400 };
        }
        await saveGoogleAdsPref(env, 'developer_token', dt);
      }
      if (body.client_id) await saveGoogleAdsPref(env, 'client_id', normalizeOAuthClientId(body.client_id));
      if (body.client_secret) await saveGoogleAdsPref(env, 'client_secret', normalizeOAuthClientSecret(body.client_secret));
      if (body.refresh_token) {
        const rt = String(body.refresh_token).trim();
        if (rt && !rt.includes('•')) await saveGoogleAdsPref(env, 'refresh_token', rt);
      }
      const prefs = await loadGoogleAdsPrefs(env);
      return { success: true, googleAds: googleAdsConfigStatus(env, prefs) };
    }
    case 'google_ads_auth_url': {
      const prefs = await loadGoogleAdsPrefs(env);
      const redirectUri = GOOGLE_ADS_REDIRECT_URI;
      try {
        const url = buildGoogleAdsAuthUrl(env, prefs, redirectUri, 'ads');
        const status = googleAdsConfigStatus(env, prefs);
        return { success: true, url, redirectUri, clientId: status.clientId, clientIdHint: status.clientIdHint };
      } catch (e) {
        return { error: String(e.message || e), status: 400 };
      }
    }
    case 'exchange_google_ads_code': {
      const prefs = await loadGoogleAdsPrefs(env);
      const code = String(body.code || '').trim();
      if (!code) return { error: 'Missing code', status: 400 };
      try {
        await exchangeGoogleAdsCode(env, prefs, code, GOOGLE_ADS_REDIRECT_URI);
        const status = googleAdsConfigStatus(env, await loadGoogleAdsPrefs(env));
        return { success: true, googleAds: status };
      } catch (e) {
        await saveGoogleAdsPref(env, 'last_error', String(e.message || e).slice(0, 500));
        return { error: String(e.message || e), status: 400 };
      }
    }
    case 'sync_google_ads': {
      const prefs = await loadGoogleAdsPrefs(env);
      try {
        const result = await syncGoogleAdsReports(env, prefs, { replace: true });
        // Auto-add panels for synced report types
        const panelsRaw = await getPref(env, 'ads_panels', '[]');
        let panels = [];
        try { panels = JSON.parse(panelsRaw); } catch (_) { panels = []; }
        for (const rep of result.reports || []) {
          if (rep.rows > 0 && !panels.includes(rep.type)) panels.push(rep.type);
        }
        if (!panels.includes('overview')) panels.unshift('overview');
        if (!panels.includes('hotlinks')) panels.push('hotlinks');
        await setPref(env, 'ads_panels', JSON.stringify(panels));
        return { success: true, ...result };
      } catch (e) {
        await saveGoogleAdsPref(env, 'last_error', String(e.message || e).slice(0, 500));
        return { error: String(e.message || e), status: 400 };
      }
    }
    case 'list_google_ads_accounts': {
      const prefs = await loadGoogleAdsPrefs(env);
      try {
        const accounts = await listAccessibleGoogleAdsAccounts(env, prefs);
        return { success: true, accounts };
      } catch (e) {
        return { error: String(e.message || e), status: 400 };
      }
    }
    case 'set_semrush_filters': {
      const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
      await setPref(env, 'semrush_filters', JSON.stringify({
        minVolume: numOr(filters.minVolume, 50),
        maxKd: numOr(filters.maxKd, 60),
        maxCpc: numOr(filters.maxCpc, 25),
        intentIncludes: String(filters.intentIncludes || '').slice(0, 200),
        excludeWords: String(filters.excludeWords || '').slice(0, 1000),
      }));
      return { success: true };
    }
    case 'save_semrush_settings': {
      if (body.domain != null) {
        await saveSemrushPref(env, 'domain', normalizeSemrushDomain(body.domain) || 'phobiafree.life');
      }
      if (body.database != null) {
        const db = String(body.database || 'us').trim().toLowerCase().slice(0, 16) || 'us';
        await saveSemrushPref(env, 'database', db);
      }
      if (body.api_key) {
        const key = normalizeApiKey(body.api_key);
        if (key) await saveSemrushPref(env, 'api_key', key);
      }
      if (body.clear_api_key) {
        await saveSemrushPref(env, 'api_key', '');
      }
      if (body.sync_sets != null) {
        const sets = parseSyncSets(body.sync_sets);
        await saveSemrushPref(env, 'sync_sets', JSON.stringify(sets.length ? sets : ['overview', 'organic', 'paid', 'competitors']));
      }
      if (body.daily_sync != null) {
        await saveSemrushPref(env, 'daily_sync', body.daily_sync ? '1' : '0');
      }
      if (body.display_limit != null) {
        const lim = Math.min(2000, Math.max(10, Number(body.display_limit) || 200));
        await saveSemrushPref(env, 'display_limit', String(lim));
      }
      const prefs = await loadSemrushPrefs(env);
      return { success: true, semrush: semrushConfigStatus(env, prefs) };
    }
    case 'sync_semrush': {
      const prefs = await loadSemrushPrefs(env);
      const sets = body.sets != null ? parseSyncSets(body.sets) : undefined;
      try {
        const result = await syncSemrushReports(env, prefs, { sets, replaceKeywords: true });
        return { success: true, ...result };
      } catch (e) {
        await saveSemrushPref(env, 'last_error', String(e.message || e).slice(0, 500));
        return { error: String(e.message || e), status: 400 };
      }
    }
    case 'import_semrush_csv': {
      const filename = String(body.filename || 'semrush.csv').slice(0, 200);
      const csv = String(body.csv || '');
      if (!csv.trim()) return { error: 'Empty CSV', status: 400 };
      const rows = parseCsv(csv).slice(0, 5000);
      if (!rows.length) return { error: 'No rows parsed', status: 400 };
      const ins = await env.phobiafree_db.prepare(`
        INSERT INTO semrush_imports (filename, row_count, created_at)
        VALUES (?, ?, datetime('now'))
      `).bind(filename, rows.length).run();
      const importId = ins.meta?.last_row_id;
      for (const row of rows) {
        const mapped = mapSemrushRow(row);
        if (!mapped.keyword) continue;
        await env.phobiafree_db.prepare(`
          INSERT INTO semrush_keywords
            (import_id, keyword, volume, kd, cpc, competition, intent, url, keep, negative, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, datetime('now'))
        `).bind(
          importId,
          mapped.keyword,
          mapped.volume,
          mapped.kd,
          mapped.cpc,
          mapped.competition,
          mapped.intent,
          mapped.url,
          JSON.stringify(row),
        ).run();
      }
      return { success: true, import_id: importId, row_count: rows.length };
    }
    case 'mark_semrush_keyword': {
      const id = parseInt(body.id, 10);
      if (!id) return { error: 'Missing id', status: 400 };
      const keep = body.keep != null ? (body.keep ? 1 : 0) : null;
      const negative = body.negative != null ? (body.negative ? 1 : 0) : null;
      if (keep !== null) {
        await env.phobiafree_db.prepare('UPDATE semrush_keywords SET keep = ?, negative = CASE WHEN ? = 1 THEN 0 ELSE negative END WHERE id = ?')
          .bind(keep, keep, id).run();
      }
      if (negative !== null) {
        await env.phobiafree_db.prepare('UPDATE semrush_keywords SET negative = ?, keep = CASE WHEN ? = 1 THEN 0 ELSE keep END WHERE id = ?')
          .bind(negative, negative, id).run();
      }
      return { success: true };
    }
    case 'clear_semrush_data': {
      await env.phobiafree_db.prepare('DELETE FROM semrush_keywords').run();
      await env.phobiafree_db.prepare('DELETE FROM semrush_imports').run();
      return { success: true };
    }
    default:
      return { error: 'Unknown ark action', status: 400 };
  }
}

const ARK_ACTIONS = new Set([
  'allow_evolve_idea',
  'run_evolve_idea',
  'chat_evolve_idea',
  'sync_evolve_idea',
  'admin_chat_send',
  'admin_chat_sync',
  'admin_chat_clear',
  'poll_evolve_agents',
  'set_ads_panels',
  'import_ads_csv',
  'clear_ads_data',
  'save_google_ads_settings',
  'google_ads_auth_url',
  'exchange_google_ads_code',
  'sync_google_ads',
  'list_google_ads_accounts',
  'set_semrush_filters',
  'save_semrush_settings',
  'sync_semrush',
  'import_semrush_csv',
  'mark_semrush_keyword',
  'clear_semrush_data',
]);

export const ADS_PANEL_CATALOG = [
  { key: 'overview', label: 'My overview (impr / clicks / cost / conv)', group: 'Mine' },
  { key: 'campaigns', label: 'Campaigns performance', group: 'Mine' },
  { key: 'ad_groups', label: 'Ad groups', group: 'Mine' },
  { key: 'keywords', label: 'Keywords (mine)', group: 'Mine' },
  { key: 'search_terms', label: 'Search terms report', group: 'Mine' },
  { key: 'negatives', label: 'Negative keywords', group: 'Mine' },
  { key: 'geo', label: 'Geographic performance', group: 'Mine' },
  { key: 'devices', label: 'Devices', group: 'Mine' },
  { key: 'auction', label: 'Auction insights', group: 'Competition' },
  { key: 'competitors', label: 'Competitor domains / URLs', group: 'Competition' },
  { key: 'competitor_stats', label: 'Competitor impression share / overlap', group: 'Competition' },
  { key: 'landing_pages', label: 'Landing pages (mine + theirs)', group: 'Competition' },
  { key: 'quality_score', label: 'Quality score components', group: 'Mine' },
  { key: 'budget', label: 'Budget & pacing', group: 'Mine' },
  { key: 'conversions', label: 'Conversions & CPA', group: 'Mine' },
  { key: 'page_hits', label: 'Site page hits (Ads reconcile)', group: 'Site' },
  { key: 'hotlinks', label: 'Google Ads hotlinks', group: 'Tools' },
  { key: 'notes', label: 'Scratch notes', group: 'Tools' },
];

async function buildAgentPrompt(env, idea, genes) {
  const geneBlock = (genes || [])
    .map((g, i) => `${i + 1}. ${g.title}: ${g.rule}`)
    .join('\n');
  const parts = [
    'You are implementing a PhobiaFree admin thought. Follow active genes as laws.',
    '',
    '## Active genes',
    geneBlock || '(none)',
    '',
    `## Domain: ${idea.domain || 'general'}`,
    `## Thought #${idea.id}`,
    idea.body || '',
  ];

  const domain = String(idea.domain || 'general').toLowerCase();
  if (domain === 'semrush' || domain === 'ads' || domain === 'general') {
    const snapshot = await buildSemrushPromptSnapshot(env);
    if (snapshot) {
      parts.push('', '## SEMrush data (live from admin)', snapshot);
    }
  }

  parts.push(
    '',
    '## Instructions',
    '- Implement this in the phobiafree-rebuild repo (Cloudflare Workers + admin).',
    '- Prefer small, shippable steps. Deploy when useful.',
    '- When the thought asks for keyword recommendations, use the SEMrush data above (keepers first, then high-volume filtered terms). Do not invent Semrush metrics.',
    '- When done, summarize what shipped and any gene mutations recommended.',
  );
  return parts.join('\n');
}

async function buildSemrushPromptSnapshot(env) {
  try {
    const prefs = await loadSemrushPrefs(env);
    const status = semrushConfigStatus(env, prefs);
    const { results: keywords } = await env.phobiafree_db
      .prepare(`
        SELECT keyword, volume, kd, cpc, intent, keep, negative
        FROM semrush_keywords
        ORDER BY keep DESC, volume DESC, id DESC
        LIMIT 80
      `)
      .all();
    if (!keywords?.length && !status.overview && !(status.competitors || []).length) return '';

    const lines = [];
    lines.push(`Domain: ${status.domain} (${status.database}) · last sync: ${status.lastSync || 'never'}`);
    if (status.overview) {
      const o = status.overview;
      lines.push(
        `Overview: rank=${o.rank ?? '—'} organicKW=${o.organicKeywords ?? '—'} organicTraffic=${o.organicTraffic ?? '—'} paidKW=${o.adwordsKeywords ?? '—'}`,
      );
    }
    const keepers = (keywords || []).filter((k) => Number(k.keep) === 1).slice(0, 30);
    const top = (keywords || []).filter((k) => Number(k.keep) !== 1 && Number(k.negative) !== 1).slice(0, 40);
    const negatives = (keywords || []).filter((k) => Number(k.negative) === 1).slice(0, 20);
    if (keepers.length) {
      lines.push('Keepers (approved):');
      keepers.forEach((k) => {
        lines.push(`- ${k.keyword} | vol=${k.volume ?? '—'} kd=${k.kd ?? '—'} cpc=${k.cpc ?? '—'} intent=${k.intent || '—'}`);
      });
    }
    if (top.length) {
      lines.push('Top keywords by volume:');
      top.forEach((k) => {
        lines.push(`- ${k.keyword} | vol=${k.volume ?? '—'} kd=${k.kd ?? '—'} cpc=${k.cpc ?? '—'} intent=${k.intent || '—'}`);
      });
    }
    if (negatives.length) {
      lines.push('Negatives (avoid): ' + negatives.map((k) => k.keyword).join(', '));
    }
    if ((status.competitors || []).length) {
      lines.push('Organic competitors:');
      status.competitors.slice(0, 15).forEach((c) => {
        lines.push(`- ${c.domain} relevance=${c.relevance ?? '—'} commonKW=${c.commonKeywords ?? '—'}`);
      });
    }
    return lines.join('\n');
  } catch (_) {
    return '';
  }
}

function parseChat(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function appendChat(chat, entry) {
  const list = Array.isArray(chat) ? chat.slice() : [];
  const row = {
    role: entry.role === 'you' ? 'you' : 'agent',
    kind: String(entry.kind || 'message').slice(0, 40),
    text: String(entry.text || '').slice(0, 8000),
    at: entry.at || new Date().toISOString(),
  };
  if (entry.runId) row.runId = String(entry.runId).slice(0, 80);
  if (entry.agentId) row.agentId = String(entry.agentId).slice(0, 80);
  list.push(row);
  // Cap history so D1 rows stay small
  return list.length > 80 ? list.slice(-80) : list;
}

function extractAgentId(note) {
  const s = String(note || '');
  const m = s.match(/\b(bc-[0-9a-f-]{20,})\b/i)
    || s.match(/cursor\.com\/agents\/(bc-[0-9a-f-]{20,})/i)
    || s.match(/cursor\.com\/agents\?id=(bc-[0-9a-f-]{20,})/i);
  return m ? m[1] : '';
}

async function loadAdminChat(env) {
  const raw = await getPref(env, 'admin_chat', '');
  if (!raw) return { messages: [], agentId: '', runId: '' };
  try {
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-80) : [],
      agentId: String(parsed.agentId || '').trim(),
      runId: String(parsed.runId || '').trim(),
    };
  } catch (_) {
    return { messages: [], agentId: '', runId: '' };
  }
}

async function saveAdminChat(env, state) {
  const clean = {
    messages: Array.isArray(state.messages) ? state.messages.slice(-80) : [],
    agentId: String(state.agentId || '').trim(),
    runId: String(state.runId || '').trim(),
  };
  await setPref(env, 'admin_chat', JSON.stringify(clean));
  return clean;
}

function buildAdminChatPrompt(question, genes) {
  const geneLines = (genes || [])
    .map((g, i) => `${i + 1}. ${g.title}: ${g.rule}`)
    .join('\n');
  return [
    'You are the PhobiaFree admin chat assistant inside /admin → Thoughts.',
    'Answer questions clearly and briefly. Do not grind UI jungles.',
    'If the user wants a code change, tell them to use Run a thought (background agent) instead of chat.',
    'Do not create or rewrite genes unless they explicitly ask.',
    geneLines ? `\nActive genes (laws):\n${geneLines}\n` : '',
    `Question:\n${question}`,
  ].filter(Boolean).join('\n');
}

function cursorAuthHeader(env) {
  const apiKey = String(env.CURSOR_API_KEY || '').trim();
  if (!apiKey) return null;
  return `Basic ${btoa(`${apiKey}:`)}`;
}

async function tryCursorCloud(env, prompt, idea) {
  const auth = cursorAuthHeader(env);
  if (!auth) {
    return {
      attempted: false,
      ok: false,
      note: 'Set Worker secret CURSOR_API_KEY (Cursor Dashboard → API Keys) so Run launches an agent.',
    };
  }

  const repo = String(env.CURSOR_GITHUB_REPO || '').trim();
  const ref = String(env.CURSOR_GITHUB_REF || 'main').trim() || 'main';
  const modelId = String(env.CURSOR_AGENT_MODEL || '').trim();
  const ideaId = idea && idea.id != null ? String(idea.id) : 'agent';
  const isChat = ideaId === 'chat';

  const body = {
    prompt: { text: prompt },
    name: (isChat ? 'PhobiaFree admin chat' : `PhobiaFree thought #${ideaId}`).slice(0, 100),
    autoCreatePR: !isChat,
  };
  if (modelId) body.model = { id: modelId };
  // Chat Q&A does not need a repo checkout; Run-a-thought agents still get the site repo.
  if (repo && !isChat) {
    body.repos = [{ url: repo, startingRef: ref }];
  }

  // Cursor Cloud Agents API — Basic auth with API key as username (curl -u KEY:)
  const res = await fetch('https://api.cursor.com/v1/agents', {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 400) }; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.raw || text.slice(0, 240) || `HTTP ${res.status}`;
    return {
      attempted: true,
      ok: false,
      note: `Cloud agent failed: ${msg}${!repo ? ' (also set CURSOR_GITHUB_REPO to your GitHub URL)' : ''}`.slice(0, 500),
    };
  }

  const agentId = data?.agent?.id || data?.id || '';
  const runId = data?.run?.id || '';
  const url = agentId
    ? `https://cursor.com/agents/${encodeURIComponent(agentId)}`
    : 'https://cursor.com/agents';
  return {
    attempted: true,
    ok: true,
    agentId,
    runId,
    url,
    note: `Cloud agent started${agentId ? ` (${agentId})` : ''}${repo ? '' : ' — no repo URL set; agent may not edit the site'}. ${url}`.slice(0, 500),
  };
}

async function sendCursorFollowUp(env, agentId, text) {
  const auth = cursorAuthHeader(env);
  if (!auth) {
    return { ok: false, status: 400, note: 'CURSOR_API_KEY not set' };
  }
  const res = await fetch(`https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/runs`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: { text } }),
  });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (_) { data = { raw: raw.slice(0, 400) }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.raw || raw.slice(0, 240) || `HTTP ${res.status}`;
    return {
      ok: false,
      status: res.status,
      note: (res.status === 409 ? 'Agent is busy — wait a moment, then retry. ' : '') + msg,
    };
  }
  const runId = data?.run?.id || data?.id || '';
  return {
    ok: true,
    runId,
    note: `Follow-up sent${runId ? ` (${runId})` : ''}. https://cursor.com/agents/${encodeURIComponent(agentId)}`.slice(0, 500),
  };
}

async function fetchCursorRun(env, agentId, runId) {
  const auth = cursorAuthHeader(env);
  if (!auth) return { ok: false, note: 'CURSOR_API_KEY not set' };

  let effectiveRunId = String(runId || '').trim();
  if (!effectiveRunId) {
    const agentRes = await fetch(`https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}`, {
      headers: { Authorization: auth },
    });
    const agentRaw = await agentRes.text();
    let agentData = {};
    try { agentData = JSON.parse(agentRaw); } catch (_) { agentData = {}; }
    if (!agentRes.ok) {
      return { ok: false, note: agentData?.error?.message || `Agent lookup HTTP ${agentRes.status}` };
    }
    effectiveRunId = agentData?.latestRunId || agentData?.agent?.latestRunId || '';
    if (!effectiveRunId) return { ok: true, runId: '', run: null };
  }

  const res = await fetch(
    `https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(effectiveRunId)}`,
    { headers: { Authorization: auth } }
  );
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (_) { data = { raw: raw.slice(0, 400) }; }
  if (!res.ok) {
    return { ok: false, note: data?.error?.message || data?.message || `Run lookup HTTP ${res.status}` };
  }
  return { ok: true, runId: effectiveRunId, run: data?.run || data };
}

async function getPref(env, key, fallback) {
  const row = await env.phobiafree_db.prepare('SELECT value FROM ark_prefs WHERE key = ?').bind(key).first();
  return row?.value != null ? row.value : fallback;
}

async function setPref(env, key, value) {
  await env.phobiafree_db.prepare(`
    INSERT INTO ark_prefs (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(key, value).run();
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return {}; }
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.every(c => !String(c).trim())) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] != null ? String(cols[idx]).trim() : ''; });
    rows.push(obj);
  }
  return rows;
}

/** Google Ads exports often have 2–15 preamble lines before the real header. */
function parseGoogleAdsCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], headers: [], headerIndex: -1, detectedType: 'other' };

  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const cols = splitCsvLine(lines[i]).map(c => c.trim());
    if (looksLikeAdsHeader(cols)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    // Fall back to first line as header (SEMrush / clean CSV)
    const simple = parseCsv(text);
    return {
      rows: simple,
      headers: simple[0] ? Object.keys(simple[0]) : [],
      headerIndex: 0,
      detectedType: detectAdsReportType(simple[0] ? Object.keys(simple[0]) : []),
    };
  }

  const headers = splitCsvLine(lines[headerIndex]).map(h => h.trim()).filter(Boolean);
  if (!headers.length) return { rows: [], headers: [], headerIndex, detectedType: 'other' };

  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.every(c => !String(c).trim())) continue;
    const first = String(cols[0] || '').trim().toLowerCase();
    if (first === 'total' || first === 'totals') continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] != null ? String(cols[idx]).trim() : ''; });
    if (Object.values(obj).some(v => v !== '')) rows.push(obj);
  }

  return {
    rows,
    headers,
    headerIndex,
    detectedType: detectAdsReportType(headers),
  };
}

function looksLikeAdsHeader(cols) {
  if (!cols || cols.length < 3) return false;
  const lower = cols.map(c => String(c).toLowerCase().trim());
  const markers = [
    'search term', 'search terms', 'keyword', 'campaign', 'ad group', 'ad group name',
    'impressions', 'impr.', 'clicks', 'cost', 'avg. cpc', 'conversions',
    'match type', 'currency code', 'display url domain', 'overlap rate',
    'impr. share', 'impression share', 'location', 'country/territory', 'device',
  ];
  let hits = 0;
  for (const m of markers) {
    if (lower.some(c => c === m || c.includes(m))) hits++;
  }
  return hits >= 2;
}

function detectAdsReportType(headers) {
  const h = (headers || []).map(x => String(x).toLowerCase());
  const has = (s) => h.some(x => x.includes(s));
  if (has('search term')) return 'search_terms';
  if (has('display url domain') || has('overlap rate') || has('position above rate') || has('outranking share')) return 'auction';
  if (has('quality score') || has('landing page exp')) return 'keywords';
  if (has('keyword') && !has('search term')) return 'keywords';
  if (has('country') || has('location') || has('metro') || has('region')) return 'geo';
  if (has('device')) return 'devices';
  if (has('ad group') && !has('search term') && !has('keyword')) return 'ad_groups';
  if (has('campaign')) return 'campaigns';
  if (has('domain') || has('competitor')) return 'competitors';
  return 'other';
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function mapSemrushRow(row) {
  const pick = (...names) => {
    for (const n of names) {
      const key = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]/g, '') === n.toLowerCase().replace(/[\s_]/g, ''));
      if (key && row[key] !== '') return row[key];
    }
    return '';
  };
  const keyword = String(pick('Keyword', 'keyword', 'Phrase', 'Search Query') || '').trim();
  const volume = parseNum(pick('Volume', 'Search Volume', 'Avg. monthly searches', 'Avg Monthly Searches'));
  const kd = parseNum(pick('Keyword Difficulty', 'KD', 'Difficulty'));
  const cpc = parseNum(pick('CPC', 'Avg. CPC', 'Cost Per Click'));
  const competition = parseNum(pick('Competition', 'Competitive Density', 'Comp'));
  const intent = String(pick('Intent', 'Search Intent') || '').trim();
  const url = String(pick('URL', 'Page', 'Landing Page') || '').trim();
  return { keyword, volume, kd, cpc, competition, intent, url };
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
