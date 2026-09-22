# Runs scripts/sync-all.mjs on this machine, on a schedule, since it turned
# out none of the ~24 non-Vercel-cron feeds (everything except weeklyreport/
# weeklyresponsereport) were actually being triggered by anything — 72h of
# production logs showed zero hits on any /api/sync/<feed> route besides
# weeklyreport. Writes straight to the same Turso DB the live dashboard
# reads from, so this has the same effect as if cron-job.org were calling
# each feed's route individually, without needing 21+ separate cron-job.org
# entries. Invoked by the "EI Dashboard Full Sync" Windows scheduled task.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "sync-all-$(Get-Date -Format 'yyyy-MM-dd-HHmm').log"

node scripts/sync-all.mjs *>&1 | Tee-Object -FilePath $logFile
