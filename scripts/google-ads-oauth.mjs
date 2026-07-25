/**
 * One-shot Google Ads OAuth — run on your PC, get a refresh_token, paste into admin.
 *
 * Uses loopback (127.0.0.1) so Cloud redirect URIs for phobiafree.life don't matter.
 * Prefer a Desktop OAuth client from Cloud Credentials (you already have those).
 *
 * Usage:
 *   node scripts/google-ads-oauth.mjs
 *   node scripts/google-ads-oauth.mjs --client-id=XXX --client-secret=YYY
 */
import http from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

async function ask(rl, label) {
  const v = (await rl.question(label)).trim();
  return v;
}

async function main() {
  const rl = createInterface({ input, output });
  let clientId = arg('client-id');
  let clientSecret = arg('client-secret');

  console.log('\nGoogle Ads OAuth — get refresh_token (then paste into admin)\n');
  console.log('Use a Desktop OAuth client from Cloud → Credentials (type: Desktop).');
  console.log(`This script listens on ${REDIRECT}\n`);

  if (!clientId) clientId = await ask(rl, 'OAuth Client ID: ');
  if (!clientSecret) clientSecret = await ask(rl, 'OAuth Client secret: ');
  rl.close();

  if (!clientId || !clientSecret) {
    console.error('Need client id and secret.');
    process.exit(1);
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
        const err = u.searchParams.get('error');
        const c = u.searchParams.get('code');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Auth error</h1><pre>${err}</pre>`);
          reject(new Error(err));
          server.close();
          return;
        }
        if (!c) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>OK — return to the terminal.</h1><p>You can close this tab.</p>');
        resolve(c);
        server.close();
      } catch (e) {
        reject(e);
        server.close();
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log('Opening browser…\n');
      console.log(authUrl.toString(), '\n');
      const start =
        process.platform === 'win32' ? 'start' :
        process.platform === 'darwin' ? 'open' : 'xdg-open';
      import('node:child_process').then(({ exec }) => {
        exec(`${start} "" "${authUrl.toString()}"`, () => {});
      });
    });
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error('Token exchange failed:', data);
    process.exit(1);
  }

  console.log('\n========== PASTE THIS INTO ADMIN ==========');
  console.log(data.refresh_token || '(no refresh_token — revoke app access in Google Account and retry)');
  console.log('===========================================\n');
  if (data.refresh_token) {
    console.log('Admin → Google Ads → Refresh token box → Save → Sync from Google now');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
