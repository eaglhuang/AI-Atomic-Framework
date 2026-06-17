param(
  [string]$AtmRepo = (Get-Location).Path,
  [string]$LogDir = "C:\Users\User\3KLife\docs\ai_atomic_framework",
  [string]$TaskName = "ATM-Broker-Run-Log-Scan",
  [int]$IntervalMinutes = 15,
  [switch]$Uninstall,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AtmRepo)) {
  throw "ATM repo not found: $AtmRepo"
}
if (-not (Test-Path -LiteralPath $LogDir)) {
  throw "Log directory not found: $LogDir"
}

$scriptPath = Join-Path $AtmRepo 'scripts\run-broker-run-log-scan.ps1'
$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -AtmRepo `"$AtmRepo`" -LogDir `"$LogDir`""

if ($RunOnce.IsPresent) {
  & powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $scriptPath -AtmRepo $AtmRepo -LogDir $LogDir
  exit 0
}

if ($Uninstall.IsPresent) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Unregistered scheduled task: $TaskName"
  } else {
    Write-Host "Scheduled task not found: $TaskName"
  }
  exit 0
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -At (Get-Date).AddMinutes(1) -Once -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 30)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances Queue -AllowStartIfOnBatteries -StartWhenAvailable
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
  Write-Host "Updated scheduled task: $TaskName"
} else {
  Register-ScheduledTask -TaskName $TaskName -InputObject $task
  Write-Host "Created scheduled task: $TaskName"
}

Write-Host "Task configured. Name=$TaskName Interval=${IntervalMinutes}m LogDir=$LogDir"
