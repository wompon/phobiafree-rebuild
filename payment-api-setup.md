# Setting up the payment-api Worker

Replaces the API actions of payment.php (the payment *page* HTML becomes a
separate static page later). Four routes:
- `POST /api/payment/generate` — admin creates a payment link (needs admin cookie + Stripe + Cloudflare Email)
- `GET  /api/payment/info` — link details for the page (needs NO Stripe secrets — just reads D1)
- `POST /api/payment/intent` — creates Stripe PaymentIntent (needs STRIPE_SECRET)
- `POST /api/payment/confirm` — verifies + marks paid + receipts (needs Stripe + Cloudflare Email + Twilio)

## Part A — Smoke test (no Stripe secrets needed)

We can confirm the worker loads and the `info` route works by first inserting a
fake payment link directly into D1, then querying it.

1. Stop the current `wrangler dev` (Ctrl+C in the server window).
2. Start this worker:
   ```
   wrangler dev payment-api-worker.js
   ```
   (note which port it says — likely 8787, 8788, or 8789)

3. In your command window, insert a test payment link into D1:
   ```
   wrangler d1 execute phobiafree-db --command="INSERT INTO payment_links (token, client_name, client_email, amount_cents, description) VALUES ('testtoken123', 'Test Client', 'test@example.com', 29900, 'Phobia Elimination Session')"
   ```

4. Fetch its info (replace PORT with the actual port):
   ```
   curl.exe "http://127.0.0.1:PORT/api/payment/info?token=testtoken123"
   ```
   You should get back JSON with clientName "Test Client", amount 29900, and
   amountFormatted "$299.00". That proves the worker + D1 read path works.

## Part B — Stripe / Twilio / Email secrets (when ready for live payments)

Set these (via `.dev.vars` for local, `wrangler secret put` for deploy):

| Secret | What it is |
|---|---|
| STRIPE_SECRET | Stripe secret key (sk_live_... or sk_test_...) |
| STRIPE_PUBLISHABLE | Stripe publishable key (pk_...) |
| SESSION_NAME | Description text, e.g. "Phobia Elimination Session" |
| SESSION_PRICE_CENTS | Price in cents, e.g. 29900 |
| NOTIFY_EMAIL | Steven's notification email |
| EMAIL | Cloudflare Email Sending binding (`bookings@phobiafree.life`) |
| TWILIO_SID / TWILIO_TOKEN / TWILIO_MESSAGING_SID | Twilio creds |
| STEVEN_PHONE | Your phone (digits) |
| SITE_URL | e.g. https://phobiafree.life (for building links) |
| SESSION_SECRET | same value as the admin worker (validates admin cookie on generate) |

**Use Stripe TEST keys (sk_test_/pk_test_) while developing** — then you can run
real test payments with Stripe's test card 4242 4242 4242 4242 without moving
real money. Switch to live keys only at launch.

### Rotate the old keys
payment.php has the live Stripe flow plus hardcoded Twilio (and old Mailgun) creds.
Regenerate Stripe and Twilio credentials before going live since the old ones are exposed in the source.

## A note on robustness (for later, not now)
The confirm step verifies the PaymentIntent with Stripe directly, same as the
old PHP. For production you'd ideally also add a Stripe *webhook* so payment is
recorded even if the customer closes the tab right after paying. Not required to
function — flagging so it's on the radar.

We'll do Part A first, one step at a time. Ready when you are.
