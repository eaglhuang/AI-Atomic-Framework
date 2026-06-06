$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
& node (Join-Path $RepoRoot "atm.mjs") explain --why blocked --json @args
exit $LASTEXITCODE