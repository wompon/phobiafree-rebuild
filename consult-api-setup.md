# Setting up the consult-api Worker

This is the booking backend (replaces consult_handler.php). It has two routes:
- `GET /api/consult/slots` — needs NO secrets, works immediately
- `POST /api/consult/book` — needs the Google/Twilio/Cloudflare Email secrets to fully work

We can test slots right now and defer the booking secrets until you're ready
to wire up real calendar/SMS/email.

## Part A — Test slot listing (no secrets needed)

1. Stop whatever `wrangler dev` is currently running (Ctrl+C in that window).
2. Start this worker:
   ```
   wrangler dev consult-api-worker.js
   ```
3. In your second window, fetch available slots:
   ```
   curl.exe http://127.0.0.1:8787/api/consult/slots
   ```
   You should get back JSON with a `days` array — each day has 30-minute slots
   for the 1–3pm and 7–9pm windows, with `available: true/false`. Since the only
   booking in the DB is our test visitor (not a real consultation), everything
   should show available.

That alone proves the core scheduling logic works.

## Part B — Booking secrets (do later, when ready for live calendar/SMS/email)

The booking route needs these secrets. Set each with `wrangler secret put NAME`
(for live deploy) or add to `.dev.vars` (for local testing). For local `.dev.vars`,
add lines like `NOTIFY_EMAIL=you@example.com`.

| Secret | What it is |
|---|---|
| GCAL_SA_EMAIL | Google service account client_email (from the JSON key file) |
| GCAL_SA_PRIVATE_KEY | Service account private_key — the full PEM block |
| GCAL_CALENDAR_ID | Which calendar to add to (your gmail address) |
| TWILIO_SID | Twilio account SID |
| TWILIO_TOKEN | Twilio auth token |
| TWILIO_MESSAGING_SID | Twilio messaging service SID |
| NOTIFY_EMAIL | Where you get booking notifications |
| EMAIL | Cloudflare Email Sending binding (`bookings@phobiafree.life`) |
| STEVEN_PHONE | Your phone for SMS alerts (just digits, e.g. 8637129312) |

### Note on GCAL_SA_PRIVATE_KEY
The old PHP read these from a JSON key file on disk
(`phobiafree-492419-fa47fd26c213.json`). Workers have no disk, so the private
key goes into a secret instead. The PEM has newlines — when putting it in
`.dev.vars` for local testing, keep them as literal `\n` (the worker's
importPrivateKey handles both real newlines and `\n`).

### Important: all your old API keys are in the source and should be rotated
The old consult_handler.php has live Twilio token, old Mailgun key, and the path to
a Google service-account key — all in plaintext. Rotate them before going live:
- Twilio auth token — regenerate in Twilio console
- Google service-account key — create a new key, delete the old one
- (Mailgun is no longer used — Workers send via Cloudflare Email)

## Part C — Test a booking locally (after Part B)

Create a booking payload file:
```
[IO.File]::WriteAllText("$PWD\book.json", '{"first_name":"Test","last_name":"User","email":"test@example.com","phone":"","phobia":"spiders","appointment_dt":"2026-07-01 13:00:00","notes":"test booking","sms_consent":false}')
```
Then:
```
curl.exe -X POST http://127.0.0.1:8787/api/consult/book --data-binary "@book.json"
```
Without the secrets set, calendar/SMS/email steps are skipped silently (the code
is best-effort on those), but the booking should still insert into D1 and return
`success: true`. Verify with:
```
wrangler d1 execute phobiafree-db --command="SELECT id, first_name, appointment_dt FROM consultations"
```

We'll go through Part A first, one step at a time. Tell me when you're ready.
