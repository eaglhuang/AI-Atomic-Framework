$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
& node (Join-Path $RepoRoot "atm.mjs") create --bucket CORE --dry-run --json @args
exit $LASTEXITCODE