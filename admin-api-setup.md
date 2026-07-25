# Setting up the admin-api Worker

This is a *second* Worker (separate from visitor-tracker-worker.js), since it
serves a different purpose (admin-only history/replay/delete + login).

## 1. Set the required secrets
Two values need to exist as Worker secrets — never hardcoded in the file
(that was the problem with the old PHP):

```
wrangler secret put SESSION_SECRET
```
When prompted, paste any long random string (this signs the login cookie —
treat it like a password; nobody else needs to know it). Example of generating
one in PowerShell:
```
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```
Copy that output and paste it when `wrangler secret put` asks.

```
wrangler secret put ADMIN_USERNAME
```
When prompted, type your admin login username (replaces the old hardcoded "launch").

## 2. Set a real admin password (replacing the CHANGE_ME placeholder)
The schema seeded `settings.admin_password` with the literal text `CHANGE_ME`
on purpose — the Worker will refuse to log in until you replace it with a
**SHA-256 hash** of your real password (never store the plain password).

Generate the hash in PowerShell:
```
$pass = "YourRealPasswordHere"
$hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($pass))) -replace '-',''
$hash.ToLower()
```
Copy the printed hash, then write it into D1:
```
wrangler d1 execute phobiafree-db --command="UPDATE settings SET setting_value = 'PASTE_HASH_HERE' WHERE setting_key = 'admin_password'"
```
(Add `--remote` once you're doing this against the live database later — for
now, no flag = local, matching everything else we've tested so far.)

## 3. Add this Worker to wrangler.toml
Since this is a separate Worker from visitor-tracker-worker.js, give it its
own config section (or its own folder/project if you'd rather keep them fully
separate — either works). Simplest: add a second `main` isn't possible in one
toml for two Workers, so for now, test it standalone with a temporary config,
or rename files when you're ready to test this one specifically:

```
wrangler dev admin-api-worker.js
```
Wrangler lets you point `dev` directly at a file without changing `main` in
wrangler.toml. It'll still pick up the `phobiafree_db` D1 binding from your
existing wrangler.toml.

## 4. Test login
With `wrangler dev admin-api-worker.js` running:
```
curl.exe -X POST http://127.0.0.1:8787/api/login -H "Content-Type: application/json" -d "{\"username\":\"YOUR_USERNAME\",\"password\":\"YourRealPasswordHere\"}" -v
```
Look for `Set-Cookie: pf_admin_session=...` in the response headers — that
means login succeeded.

## 5. Test the protected endpoints
Save the cookie and reuse it:
```
curl.exe http://127.0.0.1:8787/api/sessions -H "Cookie: pf_admin_session=PASTE_VALUE_FROM_STEP_4"
```
Should return the visitor history list as JSON (it'll be empty/short right
now since we've only sent a couple of test pings).

We'll go through steps 1–5 one at a time, same as before — just let me know
when you're ready to start with step 1.
