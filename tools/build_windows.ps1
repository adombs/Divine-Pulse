<#
Builds the Windows release of Divine Pulse into release\ with tools\build.py:

  Divine-Pulse-<version>-windows-portable.zip   unzip anywhere and run "Divine Pulse.exe"
  Divine-Pulse-<version>-setup.exe              installer (only when Inno Setup 6 is installed)
  SHA256SUMS.txt                                checksums of the above

Usage (from the project folder):
  powershell -ExecutionPolicy Bypass -File tools\build_windows.ps1 [-SkipTests] [-NoInstaller]

This finds the newest Python 3.12+ (the py launcher, or python.exe on PATH) and runs tools\build.py with it, which
makes its own build environment. Needs Node.js 22.12+.
#>
param(
    [switch]$SkipTests,
    [switch]$NoInstaller,
    # Python 3.12+ to create the build environment from (default: the first one found).
    [string]$Python
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Python 3.12+: -Python <path>, else the newest one the "py" launcher knows, else python.exe files on PATH. Input is
# closed so a probe can never sit waiting for typing.
$base = $Python
if (-not $base) {
    # Probes may print to stderr ("No suitable Python runtime found"); in Windows PowerShell 5.1 that would be a
    # terminating error under "Stop", so they run with "Continue".
    $ErrorActionPreference = "Continue"
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        # "py -0p" lists " -V:3.14 *   C:\...\python.exe"; newest first after sorting by version.
        $listed = foreach ($line in ($null | & py -0p 2>$null)) {
            if ("$line" -match "-V:3\.(\d+)\S*\s+\*?\s*(\S.*\.exe)\s*$") { [pscustomobject]@{ Minor = [int]$Matches[1]; Exe = $Matches[2].Trim() } }
        }
        $candidates += ($listed | Sort-Object Minor -Descending).Exe
    }
    $candidates += (Get-Command python -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" }).Source
    foreach ($exe in $candidates) {
        $out = "$($null | & $exe --version 2>&1)"
        if ($out -match "Python 3\.(\d+)\." -and [int]$Matches[1] -ge 12) { $base = $exe; break }
    }
    $ErrorActionPreference = "Stop"
}
if (-not $base) { throw "Python 3.12 or newer wasn't found. Install it from python.org, or pass -Python C:\path\to\python.exe" }
Write-Host "Using $base"

$buildArgs = @((Join-Path $root "tools\build.py"))
if ($SkipTests) { $buildArgs += "--skip-tests" }
if ($NoInstaller) { $buildArgs += "--no-installer" }
& $base @buildArgs
if ($LASTEXITCODE -ne 0) { throw "The build failed (exit code $LASTEXITCODE)" }
