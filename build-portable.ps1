$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cacheName = 'electron\Cache\electron-v33.4.11-win32-x64.zip'
$candidates = @( (Join-Path $env:LOCALAPPDATA $cacheName), (Join-Path $env:USERPROFILE ('AppData\Local\' + $cacheName)) )
$zip = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$zip) { throw "Electron runtime not found. Download Electron v33.4.11 for win32-x64 into the local Electron cache." }
$target = Join-Path $root 'dist\GIR Studio Desk'
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $target
Rename-Item -LiteralPath (Join-Path $target 'electron.exe') -NewName 'GIR Studio Desk.exe'
$app = Join-Path $target 'resources\app'
New-Item -ItemType Directory -Path $app | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'package.json'),(Join-Path $root 'main.cjs'),(Join-Path $root 'preload.cjs'),(Join-Path $root 'index.html'),(Join-Path $root 'app.js'),(Join-Path $root 'style.css'),(Join-Path $root 'extras.css'),(Join-Path $root 'import-xlsx.ps1') -Destination $app
New-Item -ItemType Directory -Path (Join-Path $app 'vendor') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'vendor\supabase.js') -Destination (Join-Path $app 'vendor')
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $target
New-Item -ItemType Directory -Path (Join-Path $target 'setup') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'supabase\schema.sql'),(Join-Path $root 'supabase\import-migration.sql') -Destination (Join-Path $target 'setup')
Write-Host "Built: $target"
