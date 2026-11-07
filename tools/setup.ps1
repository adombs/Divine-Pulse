# One-time setup: Python venv + dependencies, frontend build, desktop shortcut.
# Run again any time to update after pulling changes.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venv = Join-Path $backend ".venv"

Write-Host "== Python environment" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Creating the venv failed. Is Python 3.12+ on PATH?" }
}
& (Join-Path $venv "Scripts\python.exe") -m pip install --upgrade pip --quiet
& (Join-Path $venv "Scripts\python.exe") -m pip install -r (Join-Path $backend "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "== Frontend build" -ForegroundColor Cyan
Push-Location $frontend
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed. Is Node.js installed?" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally {
    Pop-Location
}

Write-Host "== Desktop shortcut" -ForegroundColor Cyan
$desktop = [Environment]::GetFolderPath("Desktop")
# Its own name, so it and the installed program's "Divine Pulse" shortcut don't replace each other.
$shortcutPath = Join-Path $desktop "Divine Pulse (source).lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $venv "Scripts\pythonw.exe"
$shortcut.Arguments = "-m app"
$shortcut.WorkingDirectory = $backend
$shortcut.IconLocation = Join-Path $backend "app\data\icon.ico"
$shortcut.Description = "Fire Emblem: Three Houses stat tracker"
$shortcut.Save()

Write-Host ""
Write-Host "Done. Launch 'Divine Pulse (source)' from your desktop." -ForegroundColor Green
Write-Host "Closing the Divine Pulse window stops the app."
