# One-time setup on Windows: Python venv + dependencies, the memory reader, the frontend build, a desktop shortcut.
# Run again any time to update after pulling changes. Then start the app with the shortcut or tools\launch.bat.
# The same steps, in the same order and with the same messages, as tools/setup.sh on macOS.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venv = Join-Path $backend ".venv"

function Fail($message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

# Python 3.12+: the newest the "py" launcher knows, else python.exe on PATH (not the Microsoft Store's alias). Probes
# may print to stderr, which "Stop" would turn into an error, so they run with "Continue"; input is closed so a probe
# can never sit waiting for typing.
$ErrorActionPreference = "Continue"
$candidates = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
    $listed = foreach ($line in ($null | & py -0p 2>$null)) {
        if ("$line" -match "-V:3\.(\d+)\S*\s+\*?\s*(\S.*\.exe)\s*$") { [pscustomobject]@{ Minor = [int]$Matches[1]; Exe = $Matches[2].Trim() } }
    }
    $candidates += ($listed | Sort-Object Minor -Descending).Exe
}
$candidates += (Get-Command python -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" }).Source
$python = $null
foreach ($exe in $candidates) {
    $out = "$($null | & $exe --version 2>&1)"
    if ($out -match "Python 3\.(\d+)\." -and [int]$Matches[1] -ge 12) { $python = $exe; break }
}
$nodeVersion = ""
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeVersion = "$($null | & node --version 2>$null)" }
$ErrorActionPreference = "Stop"
if (-not $python) { Fail "Python 3.12 or newer is needed (for example from python.org)." }
if (-not ($nodeVersion -match "^v(\d+)\.(\d+)") -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 12)) {
    Fail "Node.js 22.12 or newer is needed (for example from nodejs.org)."
}

Write-Host "== Python environment" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    & $python -m venv $venv
    if ($LASTEXITCODE -ne 0) { Fail "Creating the venv failed." }
}
& (Join-Path $venv "Scripts\python.exe") -m pip install --upgrade pip --quiet
& (Join-Path $venv "Scripts\python.exe") -m pip install -r (Join-Path $backend "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { Fail "pip install failed" }

Write-Host "== Memory reader" -ForegroundColor Cyan
Write-Host "Nothing to build: on Windows the app reads the emulator's memory itself."

Write-Host "== Frontend build" -ForegroundColor Cyan
Push-Location $frontend
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "Frontend build failed" }
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
Write-Host $shortcutPath

Write-Host ""
Write-Host "Done. Start Divine Pulse with 'Divine Pulse (source)' on your desktop, or tools\launch.bat." -ForegroundColor Green
Write-Host "Closing the Divine Pulse window stops the app."
