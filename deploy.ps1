# deploy.ps1 - canonical PhobiaFree deploy.
#
# One command that makes the repo the single source of truth and pushes it live:
#   1. build-bento         -> rebuild static fear pages into public/
#   2. publish-editor-src  -> copy bento sources into public/editor-src (asset fallback)
#   3. publish-r2          -> sync CODE/design files into R2 (so live compose uses them)
#   4. deploy phobiafree-site   (main site + /api/chat + /api/chat/sms webhook + assets)
#
# Chat (incl. the Twilio inbound /sms webhook) now lives entirely in
# phobiafree-site at /api/chat. The old standalone phobiafree-chat worker was
# retired. If you ever need it back: `npx wrangler deploy -c wrangler.jsonc`.
#
# Run from the repo root:  ./deploy.ps1
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host "`n[1/4] build-bento" -ForegroundColor Cyan
node scripts/build-bento.js

Write-Host "`n[2/4] publish-editor-src" -ForegroundColor Cyan
node scripts/publish-editor-src.js

Write-Host "`n[3/4] publish-r2 (sync code files to R2)" -ForegroundColor Cyan
node scripts/publish-r2.js

Write-Host "`n[4/4] deploy phobiafree-site" -ForegroundColor Cyan
npx wrangler deploy -c wrangler-site.jsonc

Write-Host "`nDeploy complete." -ForegroundColor Green
