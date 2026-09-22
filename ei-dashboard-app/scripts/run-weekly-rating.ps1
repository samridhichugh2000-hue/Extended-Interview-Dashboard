# Runs the weekly AI-rating pass headlessly via Claude Code, on this machine,
# using the same account/credentials as an interactive session (no separate
# API key). Invoked by the "EI Dashboard Weekly Rating" Windows scheduled
# task (Wednesdays ~18:30 IST) — see scripts/weekly-rating-prompt.txt for
# what it's told to do.
#
# Tool access is a narrow allowlist (Read, Write, and only these two exact
# script invocations via Bash) with --permission-prompts none, so anything
# outside that allowlist is auto-denied rather than bypassed or left hanging
# unattended — deliberately not using --permission-mode bypassPermissions,
# since this reads employee-authored response text.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$claude = 'C:\Users\ragha\AppData\Roaming\npm\claude.cmd'
$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'weekly-rating-prompt.txt')
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "weekly-rating-$(Get-Date -Format 'yyyy-MM-dd-HHmm').log"

$allowedTools = 'Read Write Bash(node scripts/list-unrated-responses.mjs*) Bash(node scripts/save-ratings.mjs*)'

$prompt | & $claude -p --permission-prompts none --allowedTools $allowedTools *>&1 | Tee-Object -FilePath $logFile
