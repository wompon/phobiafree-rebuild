const TIMEZONE = 'America/New_York';

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

async function getAccessToken(env) {
  if (!env.GCAL_SA_EMAIL || !env.GCAL_SA_PRIVATE_KEY) return null;
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
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token || null;
}

export async function gcalCreateEvent(env, summary, description, dtLocal, durationMins = 60) {
  const token = await getAccessToken(env);
  const calId = env.GCAL_CALENDAR_ID;
  if (!token || !calId) return null;

  const startLocal = dtLocal.replace(' ', 'T');
  const startDate = new Date(startLocal);
  const endDate = new Date(startDate.getTime() + durationMins * 60000);
  const rfc = (d) => d.toISOString();

  const eventBody = {
    summary,
    description,
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

  const evRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );
  const evData = await evRes.json();
  return evData.id || null;
}

export async function gcalDeleteEvent(env, eventId) {
  if (!eventId) return false;
  const token = await getAccessToken(env);
  const calId = env.GCAL_CALENDAR_ID;
  if (!token || !calId) return false;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return res.ok || res.status === 404;
}
