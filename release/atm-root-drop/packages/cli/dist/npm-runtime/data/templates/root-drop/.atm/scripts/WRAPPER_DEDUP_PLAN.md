# Root-Drop Wrapper PS1/SH Dedup Plan

Tracked by TASK-ATD-0027.

## Current shape

Each of 7 ATM CLI entry points ships as TWO wrapper files — one PowerShell
(`.ps1`) and one POSIX shell (`.sh`):

```
.atm/scripts/
├── ps/
│   ├── atm-create.ps1   (~5 lines)
│   ├── atm-evidence.ps1
│   ├── atm-handoff.ps1
│   ├── atm-lock.ps1
│   ├── atm-next.ps1
│   ├── atm-orient.ps1
│   └── atm-upgrade-scan.ps1
└── sh/
    ├── atm-create.sh
    ├── atm-evidence.sh
    ├── atm-handoff.sh
    ├── atm-lock.sh
    ├── atm-next.sh
    ├── atm-orient.sh
    └── atm-upgrade-scan.sh
```

14 files, average ~5 lines each, mechanically identical structurally:

```powershell
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
& node (Join-Path $RepoRoot "atm.mjs") <command> --json @args
exit $LASTEXITCODE
```

```sh
#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
exec node "$REPO_ROOT/atm.mjs" <command> --json "$@"
```

The only per-script variant is the `<command>` token. Everything else is
boilerplate.

## Duplication risk

Without dedup, any change to wrapper semantics (e.g. adding a wrapper-side
`--cwd` injection, changing the error-suppression behavior, switching to
`exec` vs `&`) requires editing 14 files. That breaks I3 (release artifact
deterministic build) if any wrapper drifts out of step.

## Proposed dedup approach

Generate the 14 wrappers from a single source of truth at build time, not
hand-author them.

### Step 1: declare the wrapper list

A new manifest at `templates/root-drop/.atm/scripts/wrappers.json`:

```json
{
  "schemaVersion": "atm.rootDropWrappers.v0.1",
  "wrappers": [
    { "name": "atm-create",        "subcommand": "create",        "alwaysJson": true },
    { "name": "atm-evidence",      "subcommand": "evidence",      "alwaysJson": true },
    { "name": "atm-handoff",       "subcommand": "handoff",       "alwaysJson": true },
    { "name": "atm-lock",          "subcommand": "lock",          "alwaysJson": true },
    { "name": "atm-next",          "subcommand": "next",          "alwaysJson": true },
    { "name": "atm-orient",        "subcommand": "orient",        "alwaysJson": true },
    { "name": "atm-upgrade-scan",  "subcommand": "upgrade-scan",  "alwaysJson": true }
  ]
}
```

### Step 2: add a generator

`scripts/build-root-drop-wrappers.ts` reads `wrappers.json` and emits both
the `.ps1` and `.sh` form for each entry into
`templates/root-drop/.atm/scripts/{ps,sh}/`. It uses two embedded template
strings:

```
PS_TEMPLATE = `
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\\..\\..")
& node (Join-Path $RepoRoot "atm.mjs") {{SUBCOMMAND}} {{JSON_FLAG}} @args
exit $LASTEXITCODE
`

SH_TEMPLATE = `
#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
exec node "$REPO_ROOT/atm.mjs" {{SUBCOMMAND}} {{JSON_FLAG}} "$@"
`
```

`{{JSON_FLAG}}` is `--json` when `alwaysJson: true`, empty otherwise.

### Step 3: add a parity validator

`scripts/validate-script-parity.ts` reads `wrappers.json` and verifies:

1. Every entry has both a `.ps1` and `.sh` file present.
2. The generated content matches what `build-root-drop-wrappers.ts` would
   produce now — no hand-edits past the generator.
3. PS1 and SH for the same command invoke the same `atm.mjs` subcommand
   with the same flag set.
4. The wrapper count matches the manifest (no orphans).

This validator runs in `validate:standard` so drift is caught immediately.

### Step 4: integrate into the build

`scripts/build-root-drop-release.ts` already exists for the root-drop
bundle. It would call `build-root-drop-wrappers.ts` as a pre-step so the
release artifact always contains regenerated wrappers.

## Parity contract

The 7 commands × 2 shells must agree on:

- Working directory derivation (both use `script_dir/../../..`).
- Argument forwarding (both pass `"$@"` / `@args` verbatim).
- Exit code propagation (PS1: `exit $LASTEXITCODE`; SH: `exec` preserves
  exit code transparently).
- `--json` flag presence (controlled by `alwaysJson` in the manifest).

## Why deferred (working tree state)

Same pre-existing-merge-conflict reason as TASK-ATD-0021 / TASK-ATD-0025.
This change touches a release artifact path (I3) where the gate is
byte-equality of generated wrappers. Doing it on a broken baseline makes
"is this wrapper byte-equal because the generator changed, or because the
release build broke?" unanswerable.

## Effort estimate

- 1 new manifest file (~30 lines).
- 1 new generator script (~80 lines).
- 1 new parity validator (~120 lines).
- Update `build-root-drop-release.ts` to call the generator (~5 lines).
- The 14 existing wrapper files become **regenerated artifacts** (not
  hand-edited).

Net effect: 14 hand-authored files → 1 manifest + 1 generator + 14
regenerated wrappers. Editing wrapper semantics becomes a single-file
change.

## Invariant exposure

- **I3** (release artifact deterministic build): the parity validator is
  the enforcement mechanism.

## Related

- [`docs/release-parity-gate.md`](../../../../docs/release-parity-gate.md)
  — the wrapper parity gate is a sibling of the release parity gate.
- [`docs/release-trust-ops.md`](../../../../docs/release-trust-ops.md) —
  the ceremony that consumes both.
