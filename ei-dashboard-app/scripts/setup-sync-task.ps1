# Re-registers the "EI Dashboard Full Sync" task so it survives a sleeping / unplugged laptop:
# runs on battery, never stops on battery, wakes the machine, catches up missed runs, and re-fires
# every hour from 06:30 until 22:30 (sync-all.mjs skips the day once it has completed and resumes
# a half-finished day from the step that was cut off).
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $PSScriptRoot 'run-sync-all.ps1'))
$t = New-ScheduledTaskTrigger -Daily -At 6:30AM
$t.Repetition = (New-ScheduledTaskTrigger -Once -At 6:30AM -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 8)
Set-ScheduledTask -TaskName 'EI Dashboard Full Sync' -Action $a -Trigger $t -Settings $s | Out-Null
(Get-ScheduledTask 'EI Dashboard Full Sync').Settings | Format-List StartWhenAvailable,WakeToRun,DisallowStartIfOnBatteries,StopIfGoingOnBatteries,ExecutionTimeLimit
