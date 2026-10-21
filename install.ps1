$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root 'dist\GIR Studio Desk'
if (!(Test-Path -LiteralPath (Join-Path $source 'GIR Studio Desk.exe'))) { throw 'Run build-portable.ps1 first.' }
$target = Join-Path $env:LOCALAPPDATA 'Programs\GIR Studio Desk'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\GIR Studio Desk.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $target 'GIR Studio Desk.exe'
$link.WorkingDirectory = $target
$link.Save()
Write-Host "Installed: $target"
