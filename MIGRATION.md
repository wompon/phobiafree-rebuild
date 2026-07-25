# PhobiaFree.life — GoDaddy → Cloudflare Migration

## Legacy stack

| Layer | GoDaddy |
|-------|---------|
| Runtime | PHP 8.x + Apache |
| Database | MySQL `phobiafreelife` |
| Chat files | Server filesystem |
| Payments | Stripe + Mailgun + Twilio |

## Cloudflare target

| Layer | Cloudflare |
|-------|------------|
| Static pages | Worker Assets (`public/`) — pre-rendered from legacy PHP |
| APIs | Workers (`site-worker.js` dispatches to existing API modules) |
| Database | D1 `phobiafree-db` |
| Chat uploads | R2 `phobiafree-chat-files` |

---

## Data model (from `phobiafreelife.sql`)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `visitor_log` | Permanent visitor sessions | `vid` (unique), `ip`, `location`, `device`, `first_seen`, `last_seen`, `total_seconds`, `pages` (JSON array) |
| `session_snapshots` | Cursor replay frames | `vid`, `snapshot` (JSON), `created_at` |
| `live_visitors` | Ephemeral live state (Worker-only) | `vid`, `data`, `pings`, `updated_at` |
| `consultations` | Booked free consultations | names, `email`, `phobia`, `appointment_dt`, questionnaire fields, `google_event_id`, `status`, `sms_consent` |
| `blocked_slots` | Admin-blocked booking times | `blocked_dt`, `reason` |
| `therapy_sessions` | Paid sessions after consult | `consultation_id`, client info, `session_dt`, `zoom_link`, `status`, `gcal_event_id` |
| `clients` | CRM records from consults | links to `consultation_id`, `archived` |
| `payment_links` | Stripe payment tokens | `token`, `amount_cents`, `paid`, `stripe_payment_intent` |
| `chat_messages` | Live text chat | `vid`, `site`, `sender`, `type`, `body`, `url`, `created_at` |
| `chat_status` | Steven online/offline | `id=1`, `status` |
| `settings` | Admin config KV | `admin_password`, `hours_windows`, `default_price_cents` |
| `visitor_messages` | Contact form (legacy) | `name`, `email`, `message` |

**MySQL dump row counts (Jul 2, 2026 export):**

| Table | Rows |
|-------|------|
| `visitor_log` | 37 |
| `session_snapshots` | ~68,000 |
| `blocked_slots` | 14 |
| `clients` | 9 |
| `payment_links` | 2 |
| `settings` | 3 |
| `consultations` | 0 (empty at export) |
| `therapy_sessions` | 0 |
| `chat_messages` | 0 |

---

## User-facing flows

### 1. Welcome funnel (`/`)

- `index.php` SPA loads welcome scenes via AJAX (`welcome-home.php`, `welcome-fear.php`, …).
- Fear cloud links to branded phobia pages or opens consult modal.
- Visitor tracker posts to `cursor_track.php` every 5s.

### 2. Phobia landing pages (`/aerophobia.php`, `*-branded.php`, …)

- Content in `$phobia` array + shared `phobia-template.php`.
- Includes: nav, booking modal, live chat widget, visitor tracker.
- CTA opens consult booking modal (`consult_handler.php`).

### 3. Consultation booking (modal + `consultation.php`)

- `GET consult_handler.php?action=get_slots` → available 30-min slots (1–3pm, 7–9pm ET).
- `POST action=book` → validates slot, inserts `consultations`, Google Calendar event, email + SMS to Steven.

### 4. Live chat (`includes/chat.php`)

- Polls `chat_handler.php` / `steven_status.php`.
- Visitor messages stored in D1 + optional Twilio SMS to Steven.
- Steven replies from admin dashboard or SMS webhook.

### 5. Visitor tracking (`cursor_track.php`)

- `POST` position/events → `visitor_log` + `session_snapshots`.
- `GET` (dashboard) → live visitors from `live_visitors` table.

### 6. Admin dashboard (`visitors.php`, `visitor_log.php`)

- Login: hardcoded `launch` / password in `settings.admin_password`.
- Replay visitor sessions, block slots, manage consultations, create payment links, schedule therapy sessions.
- **No forgot-password flow.**

### 7. Payments (`payment.php`)

- Tokenized links in `payment_links`.
- Stripe PaymentIntent create/confirm.
- Receipt emails via Mailgun.

---

## API route mapping (PHP → Worker)

| Legacy | Cloudflare |
|--------|------------|
| `cursor_track.php` | `POST/GET /track` |
| `chat_handler.php` | `/api/chat` |
| `steven_status.php` | `GET/POST /api/chat/status` |
| `consult_handler.php?action=get_slots` | `GET /api/consult/slots` |
| `consult_handler.php` POST book | `POST /api/consult/book` |
| `payment.php` actions | `/api/payment/*` |
| `visitors.php` JSON APIs | `/api/admin/*` |

---

## Import plan

1. Apply `schema.sql` (SQLite/D1 syntax, all columns preserved).
2. Run `node scripts/import-mysql-to-d1.js` → `import/generated.sql`.
3. `wrangler d1 execute phobiafree-db --remote --file import/generated.sql`.
4. Verify: `node scripts/verify-counts.js` compares dump vs D1.

---

## Build plan

1. `node scripts/build-static.js` — PHP CLI renders all public pages into `public/`.
2. Patches API URLs in HTML/JS (`cursor_track.php` → `/track`, etc.).
3. `wrangler deploy -c wrangler-site.jsonc` — site worker + assets.
4. Redeploy API workers (or use unified `site-worker.js`).
5. DNS: AAAA `@` and `www` → `100::` (proxied).

---

## Out of scope (v1)

- Builder subsystem (`builder/` — site generator for clones).
- New features or redesign.
- Google Calendar / Stripe credential rotation (reuse existing secrets).
