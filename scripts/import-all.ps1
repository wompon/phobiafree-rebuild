# Import all generated SQL files into remote D1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Importing 00-clear-and-small.sql..."
wrangler d1 execute phobiafree-db --remote --file import/00-clear-and-small.sql

$files = Get-ChildItem import/snapshots-*.sql | Sort-Object Name
$i = 0
foreach ($f in $files) {
  $i++
  Write-Host "[$i/$($files.Count)] $($f.Name)..."
  wrangler d1 execute phobiafree-db --remote --file $f.FullName
}

Write-Host "Done. Verifying counts..."
node scripts/verify-counts.js
