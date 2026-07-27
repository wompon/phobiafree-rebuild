/**
 * consult-api Worker
 * Replaces: consult_handler.php
 *
 * Routes:
 *   GET  /api/consult/slots   -> available 30-min slots for next 30 days
 *   POST /api/consult/book    -> book a consultation (JSON body)
 *   POST /api/consult/testimonial-release -> signed testimonial/media release
 *
 * What it does, same as the old PHP:
 *   1. Computes open slots from fixed daily windows, minus already-booked
 *      (consultations) and admin-blocked (blocked_slots) times.
 *   2. On booking: validates, re-checks the slot is still free (race guard),
 *      creates a Google Calendar event via service-account JWT, inserts the
 *      row into D1, then fires notification email (Cloudflare) + SMS (Twilio).
 *
 * Required secrets (wrangler secret put ...):
 *   GCAL_SA_EMAIL        - service account client_email
 *   GCAL_SA_PRIVATE_KEY  - service account private_key (full PEM, keep newlines)
 *   GCAL_CALENDAR_ID     - calendar to add events to (e.g. your gmail)
 *   TWILIO_SID           - Twilio account SID
 *   TWILIO_TOKEN         - Twilio auth token
 *   TWILIO_MESSAGING_SID - Twilio messaging service SID
 *   NOTIFY_EMAIL         - where Steven gets booking notifications
 *   STEVEN_PHONE         - Steven's phone for SMS booking alerts (digits, e.g. 8637129312)
 *   EMAIL                - Cloudflare Email Sending binding (bookings@phobiafree.life)
 *
 * Config constants below match the old PHP (windows, timezone, slot length).
 */

import { getHoursWindows } from './lib/settings.js';

const TIMEZONE = 'America/New_York';
const SLOT_MINUTES = 30;
const LOOKAHEAD_DAYS = 30;
const LEAD_TIME_HOURS = 2; // earliest bookable slot = now + 2h
/** Hold Steven's notify email so step-2 answers can merge into one message. */
const NOTIFY_DELAY_MINUTES = 5;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // tighten to your real domain before launch
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/consult/slots' && request.method === 'GET') {
        return await getAvailableSlots(env);
      }
      if (url.pathname === '/api/consult/book' && request.method === 'POST') {
        return await bookConsultation(request, env);
      }
      if (url.pathname === '/api/consult/update' && request.method === 'POST') {
        return await updateConsultationDetails(request, env);
      }
      if (url.pathname === '/api/consult/testimonial-release' && request.method === 'POST') {
        return await submitTestimonialRelease(request, env);
      }
      return json({ success: false, message: 'Unknown action.' }, 404);
    } catch (err) {
      return json({ success: false, message: String(err) }, 500);
    }
  },
  async scheduled(_event, env) {
    await flushPendingNotifyEmails(env);
  },
};

// ── Datetime helpers ──────────────────────────────────────────────────────
// We work with "Y-m-d H:i:s" strings in the practice's local timezone, matching
// how the old PHP stored appointment_dt. To compare correctly against "now" in
// that timezone, we derive the current local wall-clock time.
function nowInTZ() {
  // en-CA gives YYYY-MM-DD; combine with HH:mm:ss from the same locale call
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  // Some runtimes emit hour "24" at midnight; normalize to "00"
  if (parts.hour === '24') parts.hour = '00';
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ── GET AVAILABLE SLOTS ───────────────────────────────────────────────────
async function getAvailableSlots(env) {
  const nowStr = nowInTZ();
  const AVAILABLE_WINDOWS = await getHoursWindows(env);

  // earliest bookable = now + LEAD_TIME_HOURS, as a local wall-clock string
  const [datePart, timePart] = nowStr.split(' ');
  const [yy, mm, dd] = datePart.split('-').map(Number);
  const [hh, mi] = timePart.split(':').map(Number);
  // build a comparable string by adding lead hours via minute math on the clock
  let leadTotalMin = hh * 60 + mi + LEAD_TIME_HOURS * 60;
  let leadDayOffset = Math.floor(leadTotalMin / (24 * 60));
  leadTotalMin = leadTotalMin % (24 * 60);
  const leadHH = Math.floor(leadTotalMin / 60);
  const leadMI = leadTotalMin % 60;
  // earliest-bookable comparator string (approximate day rollover handled below)
  const earliestCmp = `${datePart} ${pad2(leadHH)}:${pad2(leadMI)}:00`;

  // Booked + blocked datetimes (>= today)
  const booked = new Set();
  const { results: bookedRows } = await env.phobiafree_db
    .prepare("SELECT appointment_dt FROM consultations WHERE appointment_dt >= datetime('now','-1 day')")
    .all();
  for (const r of bookedRows) booked.add(normalizeDt(r.appointment_dt));

  const { results: blockedRows } = await env.phobiafree_db
    .prepare("SELECT blocked_dt FROM blocked_slots WHERE blocked_dt >= datetime('now','-1 day')")
    .all();
  for (const r of blockedRows) booked.add(normalizeDt(r.blocked_dt));

  const days = [];
  const base = new Date(`${datePart}T00:00:00`);
  for (let d = 0; d < LOOKAHEAD_DAYS; d++) {
    const day = new Date(base);
    day.setDate(day.getDate() + d);
    const y = day.getFullYear(), m = day.getMonth() + 1, dn = day.getDate();
    const dateStr = `${y}-${pad2(m)}-${pad2(dn)}`;
    const dayLabel = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const daySlots = [];
    for (const [startH, endH] of AVAILABLE_WINDOWS) {
      for (let hour = startH; hour < endH; hour++) {
        for (const minute of [0, 30]) {
          const slotKey = `${dateStr} ${pad2(hour)}:${pad2(minute)}:00`;
          // future check: same-day uses lead-time comparator; future days always pass
          const isFutureDay = d > leadDayOffset || (d === 0 ? false : true);
          const passesLead = d === 0 ? slotKey > earliestCmp : isFutureDay;
          if (!passesLead) continue;
          daySlots.push({
            datetime: slotKey,
            label: labelTime(hour, minute),
            available: !booked.has(slotKey),
          });
        }
      }
    }
    if (daySlots.length) days.push({ date: dateStr, label: dayLabel, slots: daySlots });
  }

  return json({ success: true, days });
}

function normalizeDt(s) {
  // D1 may return "YYYY-MM-DD HH:MM:SS" already; trim any trailing ".000" or "T"
  return String(s).replace('T', ' ').slice(0, 19);
}

function labelTime(hour, minute) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  let h12 = hour % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(minute)} ${ampm}`;
}

// ── BOOK CONSULTATION ─────────────────────────────────────────────────────
async function readConsultBody(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    return await request.json().catch(() => null);
  }
  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    try {
      const fd = await request.formData();
      const obj = {};
      for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v : '';
      obj.sms_consent = !!(fd.get('sms_consent'));
      return obj;
    } catch {
      return null;
    }
  }
  return await request.json().catch(() => null);
}

async function bookConsultation(request, env) {
  const body = await readConsultBody(request);
  if (!body) return json({ success: false, message: 'Invalid request.' }, 400);

  const f = (k) => (body[k] || '').toString().trim();
  const first_name = f('first_name');
  const last_name = f('last_name');
  const email = f('email');
  const phone = f('phone');
  const phobia = f('phobia');
  const appointment_dt = f('appointment_dt');
  const notes = f('notes');
  const q_duration = f('q_duration');
  const q_intensity = f('q_intensity');
  const q_interference = f('q_interference');
  const q_cause = f('q_cause');
  const q_impact = f('q_impact');
  const q_outcome = f('q_outcome');
  const q_previous = f('q_previous');
  const q_cost = f('q_cost');
  const ip = request.headers.get('CF-Connecting-IP') || '';

  const sms_consent = body.sms_consent ? 1 : 0;
  const consent_ts = sms_consent ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

  if (!first_name || !last_name || !email || !appointment_dt) {
    return json({ success: false, message: 'Please fill in all required fields including a time slot.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ success: false, message: 'Please enter a valid email address.' });
  }

  // Race guard — re-check slot still open
  const taken = await env.phobiafree_db
    .prepare('SELECT id FROM consultations WHERE appointment_dt = ?')
    .bind(appointment_dt).first();
  if (taken) {
    return json({ success: false, message: 'Sorry, that slot was just taken. Please pick another time.' });
  }
  const blocked = await env.phobiafree_db
    .prepare('SELECT id FROM blocked_slots WHERE blocked_dt = ?')
    .bind(appointment_dt).first();
  if (blocked) {
    return json({ success: false, message: 'That slot is unavailable. Please choose another time.' });
  }

  // Google Calendar (best-effort; booking still succeeds if it fails)
  let google_event_id = '';
  try {
    google_event_id = await addToGoogleCalendar(env, {
      first_name, last_name, email, phone, phobia, appointment_dt, notes,
    }) || '';
  } catch (e) {
    google_event_id = '';
  }

  // Insert into D1
  const res = await env.phobiafree_db.prepare(`
    INSERT INTO consultations
      (first_name, last_name, email, phone, phobia, appointment_dt, notes,
       q_duration, q_intensity, q_interference, q_cause, q_impact, q_cost, q_outcome, q_previous,
       google_event_id, ip_address, sms_consent, consent_timestamp)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    first_name, last_name, email, phone, phobia, appointment_dt, notes,
    q_duration, q_intensity, q_interference, q_cause, q_impact, q_cost, q_outcome, q_previous,
    google_event_id, ip, sms_consent, consent_ts
  ).run();

  const newId = res.meta.last_row_id;
  const dtF = formatApptLabel(appointment_dt);

  // Steven's detailed notify email is delayed (~5 min) so step-2 answers can
  // merge into a single message. Client confirm + SMS stay immediate.

  // Confirmation email to client (best-effort)
  const clientBody =
    `Dear ${first_name},\n\n` +
    `Your appointment has been scheduled:\n\n` +
    `  Date and Time: ${dtF}\n` +
    `  Format:        Private Zoom call\n` +
    `  Duration:      30 minutes\n\n` +
    `I will send your Zoom link before the appointment.\n` +
    `To make any changes, please reply to this message.\n\n` +
    `Looking forward to speaking with you.\n\n` +
    `Steven Shaw\n` +
    `Certified Clinical Hypnotherapist\n` +
    `PhobiaFree.life\n`;
  try {
    await sendEmail(env, email, 'Your Appointment is Confirmed — PhobiaFree.life', clientBody, env.NOTIFY_EMAIL);
  } catch {}

  // SMS to client (only with phone + consent)
  if (phone && sms_consent) {
    try {
      await sendSMS(env, phone,
        `Hi ${first_name}, your PhobiaFree.life consultation is confirmed for ${dtF}. ` +
        `I look forward to speaking with you. Reply with any questions. — Steven Shaw`);
    } catch {}
  }

  // SMS to Steven
  try {
    await sendSMS(env, env.STEVEN_PHONE,
      `New booking: ${first_name} ${last_name} — ${phobia} — ${dtF}` +
      (phone ? ` — ${phone}` : '') +
      (sms_consent ? ' — SMS consent: Yes' : ''));
  } catch {}

  return json({
    success: true,
    id: newId,
    message: `You're confirmed, ${first_name}! Your consultation is scheduled for ${dtF}. A confirmation has been sent to ${email}.`,
  });
}

async function updateConsultationDetails(request, env) {
  const body = await readConsultBody(request);
  if (!body) return json({ success: false, message: 'Invalid request.' }, 400);

  const id = Number(body.id || body.booking_id || 0);
  if (!id) return json({ success: false, message: 'Missing booking id.' }, 400);

  const f = (k) => (body[k] || '').toString().trim();
  const notes = f('notes');
  const q_duration = f('q_duration');
  const q_intensity = f('q_intensity');
  const q_interference = f('q_interference');
  const q_cause = f('q_cause');
  const q_impact = f('q_impact');
  const q_cost = f('q_cost');
  const q_outcome = f('q_outcome');
  const q_previous = f('q_previous');

  const existing = await env.phobiafree_db
    .prepare(`
      SELECT id, first_name, last_name, email, phone, phobia, appointment_dt,
             google_event_id, sms_consent, notify_sent_at
      FROM consultations WHERE id = ?
    `)
    .bind(id).first();
  if (!existing) return json({ success: false, message: 'Booking not found.' }, 404);

  await env.phobiafree_db.prepare(`
    UPDATE consultations SET
      notes = ?, q_duration = ?, q_intensity = ?, q_interference = ?,
      q_cause = ?, q_impact = ?, q_cost = ?, q_outcome = ?, q_previous = ?
    WHERE id = ?
  `).bind(
    notes, q_duration, q_intensity, q_interference,
    q_cause, q_impact, q_cost, q_outcome, q_previous,
    id
  ).run();

  // Prefer one combined notify email when the delayed book email hasn't gone out.
  // If the delayed email already went, send a details-only follow-up.
  if (!existing.notify_sent_at) {
    await sendStevenNotifyIfPending(env, id);
  } else {
    const dtF = formatApptLabel(existing.appointment_dt);
    const followUp =
      `Pre-consultation details updated for booking #${id}\n\n` +
      `Name:    ${existing.first_name} ${existing.last_name}\n` +
      `Email:   ${existing.email}\n` +
      `Concern: ${existing.phobia || 'Not specified'}\n` +
      `When:    ${dtF}\n\n` +
      `Notes:\n${notes || 'None'}\n\n` +
      `─── Pre-Consultation Answers ───\n` +
      `Duration:      ${q_duration || 'Not answered'}\n` +
      `Intensity:     ${q_intensity || 'Not answered'}\n` +
      `Interference:  ${q_interference || 'Not answered'}\n\n` +
      `Cause:\n${q_cause || 'Not answered'}\n\n` +
      `Life impact:\n${q_impact || 'Not answered'}\n\n` +
      `Cost to life:\n${q_cost || 'Not answered'}\n\n` +
      `Life without fear:\n${q_outcome || 'Not answered'}\n\n` +
      `Previous therapies:\n${q_previous || 'Not answered'}\n`;
    try {
      await sendEmail(
        env,
        env.NOTIFY_EMAIL,
        `Booking details updated: ${existing.first_name} ${existing.last_name} (#${id})`,
        followUp,
        existing.email
      );
    } catch {}
  }

  return json({
    success: true,
    message: 'Thanks — your answers were saved. Looking forward to our call.',
  });
}

function buildStevenNotifyBody(row) {
  const dtF = formatApptLabel(row.appointment_dt);
  return (
    `New appointment from PhobiaFree.life\n\n` +
    `Name:        ${row.first_name} ${row.last_name}\n` +
    `Email:       ${row.email}\n` +
    `Phone:       ${row.phone || 'Not provided'}\n` +
    `Concern:     ${row.phobia || 'Not specified'}\n` +
    `Scheduled:   ${dtF}\n` +
    `SMS Consent: ${row.sms_consent ? 'Yes' : 'No'}\n\n` +
    `Notes:\n${row.notes || 'None'}\n\n` +
    `─── Pre-Consultation Answers ───\n` +
    `Duration:      ${row.q_duration || 'Not answered'}\n` +
    `Intensity:     ${row.q_intensity || 'Not answered'}\n` +
    `Interference:  ${row.q_interference || 'Not answered'}\n\n` +
    `Cause:\n${row.q_cause || 'Not answered'}\n\n` +
    `Life impact:\n${row.q_impact || 'Not answered'}\n\n` +
    `Cost to life:\n${row.q_cost || 'Not answered'}\n\n` +
    `Life without fear:\n${row.q_outcome || 'Not answered'}\n\n` +
    `Previous therapies:\n${row.q_previous || 'Not answered'}\n\n` +
    `Calendar:    ${row.google_event_id ? 'Added' : 'Not added'}\n` +
    `Record ID:   #${row.id}\n`
  );
}

/** Claim + send Steven notify once. Returns true if this call sent it. */
async function sendStevenNotifyIfPending(env, id) {
  const claim = await env.phobiafree_db
    .prepare(`
      UPDATE consultations
      SET notify_sent_at = datetime('now')
      WHERE id = ? AND notify_sent_at IS NULL
    `)
    .bind(id)
    .run();
  if (!claim.meta || !claim.meta.changes) return false;

  const row = await env.phobiafree_db
    .prepare(`
      SELECT id, first_name, last_name, email, phone, phobia, appointment_dt,
             notes, q_duration, q_intensity, q_interference, q_cause, q_impact,
             q_cost, q_outcome, q_previous, google_event_id, sms_consent
      FROM consultations WHERE id = ?
    `)
    .bind(id)
    .first();
  if (!row) return false;

  try {
    await sendEmail(
      env,
      env.NOTIFY_EMAIL,
      `New Appointment: ${row.first_name} ${row.last_name} (#${row.id})`,
      buildStevenNotifyBody(row),
      row.email
    );
  } catch {}
  return true;
}

/** Cron: send notify emails for bookings older than NOTIFY_DELAY_MINUTES with no step-2 yet. */
async function flushPendingNotifyEmails(env) {
  const { results } = await env.phobiafree_db
    .prepare(`
      SELECT id FROM consultations
      WHERE notify_sent_at IS NULL
        AND submitted_at <= datetime('now', ?)
      ORDER BY id ASC
      LIMIT 25
    `)
    .bind(`-${NOTIFY_DELAY_MINUTES} minutes`)
    .all();

  for (const row of results || []) {
    try {
      await sendStevenNotifyIfPending(env, row.id);
    } catch (err) {
      console.error('flushPendingNotifyEmails failed for', row.id, err);
    }
  }
}

function formatApptLabel(dtStr) {
  // dtStr is "YYYY-MM-DD HH:MM:SS" local wall time; present it nicely.
  const d = new Date(dtStr.replace(' ', 'T'));
  const datePart = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const [h, m] = dtStr.split(' ')[1].split(':').map(Number);
  return `${datePart} at ${labelTime(h, m)}`;
}

// ── GOOGLE CALENDAR via service-account JWT (Web Crypto, no libraries) ─────
async function addToGoogleCalendar(env, ev) {
  if (!env.GCAL_SA_EMAIL || !env.GCAL_SA_PRIVATE_KEY || !env.GCAL_CALENDAR_ID) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GCAL_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const toSign = `${header}.${claim}`;

  const key = await importPrivateKey(env.GCAL_SA_PRIVATE_KEY);
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(toSign)
  );
  const jwt = `${toSign}.${b64urlBytes(new Uint8Array(sigBuf))}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return null;

  // Build event start/end with explicit timezone offset
  const startLocal = ev.appointment_dt.replace(' ', 'T');
  const startDate = new Date(startLocal);
  const endDate = new Date(startDate.getTime() + SLOT_MINUTES * 60000);
  const rfc = (d) => d.toISOString();

  const eventBody = {
    summary: `PhobiaFree Consultation: ${ev.first_name} ${ev.last_name}`,
    description: `Phobia: ${ev.phobia}\nPhone: ${ev.phone}\nEmail: ${ev.email}\n\nNotes:\n${ev.notes}`,
    start: { dateTime: rfc(startDate), timeZone: TIMEZONE },
    end: { dateTime: rfc(endDate), timeZone: TIMEZONE },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const calId = encodeURIComponent(env.GCAL_CALENDAR_ID);
  const evRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );
  const evData = await evRes.json();
  return evData.id || null;
}

// Import a PEM PKCS#8 private key for RSASSA-PKCS1-v1_5 signing
async function importPrivateKey(pem) {
  const clean = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── TWILIO SMS ─────────────────────────────────────────────────────────────
async function sendSMS(env, to, bodyText) {
  let digits = (to || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '+1' + digits;
  else if (digits.length === 11 && digits[0] === '1') digits = '+' + digits;
  else return false;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        MessagingServiceSid: env.TWILIO_MESSAGING_SID,
        To: digits,
        Body: bodyText,
      }),
    }
  );
  return res.ok;
}

// ── TESTIMONIAL / MEDIA RELEASE ───────────────────────────────────────────
async function ensureTestimonialReleasesTable(env) {
  await env.phobiafree_db.prepare(`
    CREATE TABLE IF NOT EXISTS testimonial_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      display_name TEXT,
      media_types TEXT,
      notes TEXT,
      agreement_version TEXT,
      signature_data TEXT,
      page_url TEXT,
      ip_address TEXT,
      user_agent TEXT,
      signed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function submitTestimonialRelease(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid request.' }, 400);
  }

  const f = (k) => (body[k] || '').toString().trim();
  const full_name = f('full_name');
  const email = f('email');
  const phone = f('phone');
  const display_name = f('display_name');
  const media_types = f('media_types') || 'written_and_video';
  const notes = f('notes');
  const agreement_version = f('agreement_version') || '2026-07';
  const page_url = f('page_url');
  const signature_data = (body.signature_data || '').toString();
  const agree = !!(body.agree === true || body.agree === 1 || body.agree === '1' || body.agree === 'true');

  if (!full_name || !email) {
    return json({ success: false, message: 'Please fill in your name and email.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (!agree) {
    return json({ success: false, message: 'Please confirm you agree to the release.' });
  }
  if (!signature_data || !signature_data.startsWith('data:image/') || signature_data.length < 200) {
    return json({ success: false, message: 'A drawn signature is required.' });
  }
  // Cap signature payload (~250KB) so D1 rows stay reasonable
  if (signature_data.length > 350000) {
    return json({ success: false, message: 'Signature data too large. Please clear and sign again.' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const user_agent = (request.headers.get('User-Agent') || '').slice(0, 400);

  await ensureTestimonialReleasesTable(env);

  const res = await env.phobiafree_db.prepare(`
    INSERT INTO testimonial_releases
      (full_name, email, phone, display_name, media_types, notes,
       agreement_version, signature_data, page_url, ip_address, user_agent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    full_name, email, phone, display_name, media_types, notes,
    agreement_version, signature_data, page_url, ip, user_agent
  ).run();

  const newId = res.meta.last_row_id;
  const signedAt = new Date().toISOString();
  const mediaLabel = ({
    written: 'Written testimonial',
    video: 'Video testimonial',
    audio: 'Audio testimonial',
    written_and_video: 'Written and/or video',
    all: 'All formats',
  })[media_types] || media_types;

  const summary =
    `Testimonial & Media Release signed\n\n` +
    `  ID:           #${newId}\n` +
    `  Name:         ${full_name}\n` +
    `  Email:        ${email}\n` +
    (phone ? `  Phone:        ${phone}\n` : '') +
    (display_name ? `  Attribution:  ${display_name}\n` : '') +
    `  Media:        ${mediaLabel}\n` +
    `  Version:      ${agreement_version}\n` +
    `  Signed at:    ${signedAt}\n` +
    (notes ? `  Notes:        ${notes}\n` : '') +
    (page_url ? `  Page:         ${page_url}\n` : '') +
    `\nThis grants PhobiaFree.life permission to use the grantor's written or video\n` +
    `testimonial on YouTube, the website, advertising, and other channels as described\n` +
    `in the Testimonial & Media Release agreement.\n` +
    `Signature image is stored with release #${newId} in the database.\n`;

  try {
    await sendEmail(
      env,
      env.NOTIFY_EMAIL || 'steven@stevenshawccht.com',
      `Testimonial release signed — ${full_name}`,
      summary,
      email
    );
  } catch {}

  const clientBody =
    `Dear ${full_name.split(/\s+/)[0] || full_name},\n\n` +
    `Thank you for signing the PhobiaFree.life Testimonial & Media Release.\n\n` +
    `This confirms you grant permission for us to use your written and/or video\n` +
    `testimonial on YouTube, our website, advertising, and other channels as\n` +
    `described in the agreement you signed.\n\n` +
    `  Reference:  #${newId}\n` +
    `  Media type: ${mediaLabel}\n` +
    `  Signed:     ${signedAt}\n\n` +
    `If you have questions, reply to this email.\n\n` +
    `Steven Shaw\n` +
    `Certified Clinical Hypnotherapist\n` +
    `PhobiaFree.life\n`;

  try {
    await sendEmail(env, email, 'Your signed Testimonial Release — PhobiaFree.life', clientBody, env.NOTIFY_EMAIL);
  } catch {}

  return json({
    success: true,
    id: newId,
    message: `Thank you, ${full_name.split(/\s+/)[0] || full_name}. Your signed release was received and a copy was sent to ${email}.`,
  });
}

// ── EMAIL (Cloudflare Email Sending only) ──────────────────────────────────
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
