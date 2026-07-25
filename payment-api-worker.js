/**
 * payment-api Worker
 * Replaces the API actions of payment.php (generate_link, create_intent,
 * confirm_payment). The payment *page* itself becomes a static HTML page that
 * calls these endpoints (see payment-page.html).
 *
 * Routes:
 *   POST /api/payment/generate   { name, email, consultation_id } -> creates a
 *                                  payment link, emails it to client + Steven.
 *                                  (Admin-only — requires the admin session cookie.)
 *   GET  /api/payment/info?token=xxx -> link details for rendering the page
 *   POST /api/payment/intent     { token } -> creates Stripe PaymentIntent,
 *                                  returns clientSecret + publishableKey
 *   POST /api/payment/confirm    { token, payment_intent } -> verifies with
 *                                  Stripe, marks paid, sends receipts
 *
 * Required secrets:
 *   STRIPE_SECRET        - Stripe secret key (sk_...)
 *   STRIPE_PUBLISHABLE   - Stripe publishable key (pk_...)
 *   SESSION_NAME         - product/description text (e.g. "Phobia Elimination Session")
 *   SESSION_PRICE_CENTS  - price in cents (e.g. 29900)
 *   NOTIFY_EMAIL         - Steven's notification email
 *   EMAIL                - Cloudflare Email Sending binding (bookings@phobiafree.life)
 *   TWILIO_SID           - Twilio account SID
 *   TWILIO_TOKEN         - Twilio auth token
 *   TWILIO_MESSAGING_SID - Twilio messaging service SID
 *   STEVEN_PHONE         - Steven's phone for SMS (digits)
 *   SITE_URL             - base URL for building payment links (e.g. https://phobiafree.life)
 *   SESSION_SECRET       - (shared with admin worker) to validate admin cookie on generate
 *
 * NOTE: This worker is best paired with a Stripe webhook for production-grade
 * payment confirmation. The confirm endpoint here verifies the PaymentIntent
 * status directly with Stripe (same approach as the old PHP), which is fine,
 * but a webhook is more robust against the user closing the tab mid-confirm.
 * Flagged for later — not blocking.
 */

import { getSessionPriceCents } from './lib/settings.js';

const COOKIE_NAME = 'pf_admin_session';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // tighten before launch
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// ── admin cookie check (reused from admin worker logic) ─────────────────
async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const m = header.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
async function isAdmin(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if ((await hmacSign(env.SESSION_SECRET, payload)) !== sig) return false;
  const expires = parseInt(payload.split(':')[1], 10);
  return Date.now() < expires;
}

function hexToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
function money(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function normalizeLinkType(raw) {
  const t = String(raw || 'standard').toLowerCase().trim();
  if (t === 'review' || t === 'veteran' || t === 'senior' || t === 'standard' || t === 'urgent') return t;
  return 'standard';
}

function isDonationType(type) {
  return type === 'review' || type === 'veteran' || type === 'senior';
}

function greetingForType(type) {
  switch (type) {
    case 'review':
      return 'Thank you for your honest review. You are so appreciated!';
    case 'veteran':
      return 'Thank you for your service!';
    case 'senior':
      return 'Thank you for your kind donation.';
    default:
      return '';
  }
}

function stripeSecret(env) {
  return env.STRIPE_SECRET || env.STRIPE_SECRET_KEY || '';
}

function stripePublishable(env) {
  return env.STRIPE_PUBLISHABLE || env.STRIPE_PUBLISHABLE_KEY || '';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/payment/generate' && request.method === 'POST') {
        return await generateLink(request, env);
      }
      if (url.pathname === '/api/payment/info' && request.method === 'GET') {
        return await paymentInfo(env, url);
      }
      if (url.pathname === '/api/payment/intent' && request.method === 'POST') {
        return await createIntent(request, env);
      }
      if (url.pathname === '/api/payment/confirm' && request.method === 'POST') {
        return await confirmPayment(request, env);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

// ── GENERATE LINK (admin only) ──────────────────────────────────────────
async function generateLink(request, env) {
  if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const consultId = parseInt(body.consultation_id || 0, 10) || null;
  const linkType = normalizeLinkType(body.link_type || body.type);
  const donation = isDonationType(linkType);

  const token = hexToken(32);
  const desc = donation
    ? (linkType === 'review' ? 'Donation — Honest review'
      : linkType === 'veteran' ? 'Donation — Veteran'
      : 'Donation — Senior')
    : (env.SESSION_NAME || 'PhobiaFree — Single Session');
  const amount = donation ? 0 : await getSessionPriceCents(env);

  await env.phobiafree_db.prepare(`
    INSERT INTO payment_links (token, consultation_id, client_name, client_email, amount_cents, description, link_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(token, consultId, name, email, amount, desc, linkType).run();

  const link = `${env.SITE_URL || 'https://phobiafree.life'}/payment.html?token=${token}`;
  const amountFmt = donation ? 'Donation (client chooses amount)' : money(amount);

  // Email to client
  let clientSent = false;
  try {
    clientSent = await sendEmail(env, email,
      'Your PhobiaFree.life Session Payment',
      `Dear ${name},\n\n` +
      `Thank you for your consultation. Please use the secure link below to complete your session payment:\n\n` +
      `  ${link}\n\n` +
      `Amount: ${amountFmt}\n` +
      `This link is unique to you and expires after use.\n\n` +
      `Once payment is received I will send your Zoom session details.\n\n` +
      `Looking forward to your session.\n\n` +
      `Steven Shaw\nCertified Clinical Hypnotherapist\nPhobiaFree.life\n`);
  } catch {}

  // Email to Steven
  try {
    await sendEmail(env, env.NOTIFY_EMAIL,
      `Payment Link Sent: ${name}`,
      `A payment link has been sent to ${name} (${email})\n\n` +
      `Amount:  ${amountFmt}\n` +
      `Link:    ${link}\n` +
      `Record:  Consultation ID #${consultId || 'N/A'}\n\n` +
      `You will be notified again when payment is completed.\n`);
  } catch {}

  return json({ success: true, link, token, client_email: clientSent ? 'sent' : 'failed' });
}

// ── PAYMENT INFO (for rendering the page) ───────────────────────────────
async function paymentInfo(env, url) {
  const token = (url.searchParams.get('token') || '').toString();
  if (!token) return json({ error: 'missing token' }, 400);

  const link = await env.phobiafree_db
    .prepare('SELECT client_name, description, amount_cents, paid, link_type, price_reason, external_pay_url FROM payment_links WHERE token = ?')
    .bind(token).first();

  if (!link) return json({ error: 'invalid', message: 'This payment link is invalid or has already been used.' });
  if (link.paid) return json({ error: 'paid', message: 'This payment has already been completed. Thank you!' });

  const linkType = normalizeLinkType(link.link_type);
  const donation = isDonationType(linkType);

  return json({
    clientName: link.client_name,
    description: link.description,
    amount: link.amount_cents,
    amountFormatted: donation ? null : money(link.amount_cents),
    linkType,
    isDonation: donation,
    greeting: greetingForType(linkType),
    priceReason: link.price_reason || null,
    externalPayUrl: link.external_pay_url || null,
  });
}

// ── CREATE STRIPE PAYMENT INTENT ────────────────────────────────────────
async function createIntent(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = (body.token || '').toString();
  const secret = stripeSecret(env);
  if (!secret) {
    return json({ error: 'Stripe is not configured on the server yet. Please contact Steven.' });
  }

  const link = await env.phobiafree_db
    .prepare('SELECT * FROM payment_links WHERE token = ? AND used = 0 AND paid = 0')
    .bind(token).first();
  if (!link) return json({ error: 'Invalid or expired payment link.' });

  const linkType = normalizeLinkType(link.link_type);
  const donation = isDonationType(linkType);
  let amount = parseInt(link.amount_cents, 10) || 0;
  if (donation) {
    const offered = parseInt(body.amount_cents, 10);
    if (!offered || offered < 100) {
      return json({ error: 'Please enter a donation amount of at least $1.00.' });
    }
    amount = offered;
    await env.phobiafree_db
      .prepare('UPDATE payment_links SET amount_cents = ? WHERE token = ?')
      .bind(amount, token).run();
  } else if (amount < 50) {
    return json({ error: 'Invalid payment amount on this link.' });
  }

  // Create PaymentIntent via Stripe REST API
  const form = new URLSearchParams();
  form.set('amount', String(amount));
  form.set('currency', 'usd');
  form.set('description', link.description || '');
  form.set('receipt_email', link.client_email || '');
  form.set('metadata[token]', token);
  form.set('metadata[client]', link.client_name || '');
  form.set('metadata[link_type]', linkType);

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(secret + ':'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const intent = await res.json();
  if (!intent.client_secret) {
    const stripeMsg = intent.error?.message || intent.message || '';
    return json({
      error: stripeMsg
        ? ('Stripe: ' + stripeMsg)
        : 'Could not initialize payment. Please try again.',
    });
  }

  await env.phobiafree_db
    .prepare('UPDATE payment_links SET stripe_payment_intent = ? WHERE token = ?')
    .bind(intent.id, token).run();

  return json({
    clientSecret: intent.client_secret,
    publishableKey: stripePublishable(env),
    amount,
    amountFormatted: money(amount),
    description: link.description,
    clientName: link.client_name,
    linkType,
  });
}

// ── CONFIRM PAYMENT ─────────────────────────────────────────────────────
async function confirmPayment(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = (body.token || '').toString();
  const intentId = (body.payment_intent || '').toString();
  const secret = stripeSecret(env);
  if (!secret) {
    return json({ success: false, message: 'Stripe is not configured.' });
  }

  // Verify with Stripe
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}`, {
    headers: { Authorization: 'Basic ' + btoa(secret + ':') },
  });
  const intent = await res.json();

  if (intent.status !== 'succeeded') {
    return json({ success: false, message: 'Payment not confirmed. Please try again.' });
  }

  await env.phobiafree_db.prepare(`
    UPDATE payment_links
    SET paid = 1, used = 1, paid_at = datetime('now'), stripe_payment_intent = ?
    WHERE token = ?
  `).bind(intentId, token).run();

  const link = await env.phobiafree_db
    .prepare('SELECT * FROM payment_links WHERE token = ?')
    .bind(token).first();

  const linkType = normalizeLinkType(link.link_type);
  const amountFmt = money(link.amount_cents);
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const donation = isDonationType(linkType);

  // Receipt to Steven
  try {
    await sendEmail(env, env.NOTIFY_EMAIL,
      `${donation ? 'Donation' : 'Payment'} Received: ${link.client_name}`,
      `${donation ? 'Donation' : 'Payment'} confirmed for ${link.client_name} (${link.client_email})\n\n` +
      `Type: ${linkType}\n` +
      `Amount: ${amountFmt}\n` +
      `Description: ${link.description}\n` +
      `Stripe ID: ${intentId}\n` +
      `Paid at: ${dateStr}\n`);
  } catch {}

  // Receipt to client
  try {
    await sendEmail(env, link.client_email,
      donation ? 'Donation Received — PhobiaFree.life' : 'Payment Confirmed — PhobiaFree.life',
      `Dear ${link.client_name},\n\n` +
      (greetingForType(linkType) ? greetingForType(linkType) + '\n\n' : '') +
      `Your ${donation ? 'donation' : 'payment'} has been received.\n\n` +
      `  Amount:      ${amountFmt}\n` +
      `  Description: ${link.description}\n` +
      `  Date:        ${dateStr}\n\n` +
      `I'll follow up by email shortly. I'm available anytime for follow-up sessions or questions — at no charge.\n\n` +
      `Steven Shaw\nPhobiaFree.life\n`);
  } catch {}

  // SMS to Steven
  try {
    await sendSMS(env, env.STEVEN_PHONE,
      `${donation ? 'Donation' : 'Payment'} received! ${link.client_name} (${linkType}) ${amountFmt}.`);
  } catch {}

  return json({ success: true, linkType, amountFormatted: amountFmt });
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
        To: digits, Body: bodyText,
      }),
    }
  );
  return res.ok;
}
