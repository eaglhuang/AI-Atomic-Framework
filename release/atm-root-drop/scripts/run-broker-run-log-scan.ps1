param(
  [string]$AtmRepo = (Get-Location).Path,
  [string]$LogDir = "C:\Users\User\3KLife\docs\ai_atomic_framework",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AtmRepo)) {
  throw "ATM repo not found: $AtmRepo"
}

if (-not (Test-Path -LiteralPath $LogDir)) {
  throw "Log directory not found: $LogDir"
}

$defaultLogName = -join @(
  [char]0x0043,[char]0x0049,[char]0x0044,
  [char]0x885D,[char]0x7A81,[char]0x89E3,
  [char]0x6C7A,[char]0x7D44,[char]0x9304,
  [char]0x006C,[char]0x006F,[char]0x0067,
  [char]0x002E,[char]0x006D,[char]0x0064
)

$resolvedLogPath = if ($LogPath) {
  $LogPath
} else {
  $candidate = Get-ChildItem -LiteralPath $LogDir -File |
    Where-Object { $_.Name -like "CID*log.md" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate) {
    $candidate.FullName
  } else {
    Join-Path $LogDir $defaultLogName
  }
}

Set-Location -LiteralPath $AtmRepo

$resolvedLogDir = Split-Path $resolvedLogPath -Parent
if (-not (Test-Path -LiteralPath $resolvedLogDir)) {
  New-Item -ItemType Directory -Force -Path $resolvedLogDir | Out-Null
}

if (-not (Test-Path -LiteralPath $resolvedLogPath)) {
  New-Item -ItemType File -Force -Path $resolvedLogPath | Out-Null
}

npm run scan:broker-runs -- --out $resolvedLogPath --append
