/**
 * update-twilio-webhook.js — point the Twilio inbound SMS webhook at the main
 * site worker (https://phobiafree.life/api/chat/sms), so the standalone
 * phobiafree-chat worker can be retired. Fully reversible (rerun with the old URL).
 *
 * Secrets are read from environment variables so they never end up in a chat log.
 *
 * PowerShell usage:
 *   $env:TWILIO_SID="ACxxxxxxxx"
 *   $env:TWILIO_TOKEN="your_auth_token"
 *   node scripts/update-twilio-webhook.js
 *
 * Optional overrides:
 *   $env:TWILIO_FROM="+15551234567"   # only update this number (else updates all)
 *   $env:SMS_WEBHOOK="https://phobiafree.life/api/chat/sms"
 */
const SID = process.env.TWILIO_SID;
const TOKEN = process.env.TWILIO_TOKEN;
const ONLY = process.env.TWILIO_FROM || '';
const WEBHOOK = process.env.SMS_WEBHOOK || 'https://phobiafree.life/api/chat/sms';

if (!SID || !TOKEN) {
  console.error('Set TWILIO_SID and TWILIO_TOKEN env vars first.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');
const base = 'https://api.twilio.com/2010-04-01/Accounts/' + SID;

async function main() {
  const listRes = await fetch(base + '/IncomingPhoneNumbers.json?PageSize=50', {
    headers: { Authorization: auth },
  });
  if (!listRes.ok) {
    console.error('List failed:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const data = await listRes.json();
  const numbers = data.incoming_phone_numbers || [];
  if (!numbers.length) {
    console.error('No phone numbers found on this account.');
    process.exit(1);
  }

  const targets = ONLY ? numbers.filter((n) => n.phone_number === ONLY) : numbers;
  if (!targets.length) {
    console.error('No number matches TWILIO_FROM=' + ONLY);
    console.error('Available:', numbers.map((n) => n.phone_number).join(', '));
    process.exit(1);
  }

  for (const n of targets) {
    console.log(`\n${n.phone_number}`);
    console.log('  old SmsUrl:', n.sms_url || '(none)');
    const upd = await fetch(base + '/IncomingPhoneNumbers/' + n.sid + '.json', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SmsUrl: WEBHOOK, SmsMethod: 'POST' }).toString(),
    });
    if (!upd.ok) {
      console.error('  update FAILED:', upd.status, await upd.text());
      continue;
    }
    const j = await upd.json();
    console.log('  new SmsUrl:', j.sms_url);
  }
  console.log('\nDone. Send yourself a test SMS reply to confirm, then retire phobiafree-chat if desired.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
