$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$release = Join-Path $root 'release'
$installer = Get-ChildItem -LiteralPath $release -Filter 'GIR-Studio-Desk-*-Setup.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$installer) { throw 'No updating installer found. Download the latest Setup.exe from https://github.com/getitrendered/gir-studio-desk/releases/latest' }
Start-Process -FilePath $installer.FullName -Wait
