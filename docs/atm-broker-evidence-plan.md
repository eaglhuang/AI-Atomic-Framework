# ATM Broker Evidence Plan

## Purpose

This document defines a reproducible Hybrid evidence pipeline for the paper without changing `atm.brokerOperationRunRecordEnvelope.v1`.

## Evidence Strategy

1. Synthetic bench runs cover deterministic mechanism scenarios: B-02, B-08, and B-13.
2. Field runs cover controlled real-task collisions: B-07 baseline and B-12 controlled 4-vendor field capture.
3. Scenario tags stay in `request_identity` or `planId` using `bench:<scenario>:<taskId>:<slug>`.
4. Field capture is post-run capture. The tools read broker envelopes and `atm.teamRun.v1` brokerLane records after execution; they do not live-intercept or mutate broker behavior.

## Reference Commands

Synthetic MVP:

```powershell
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-02 --output-dir .atm-temp/bench-b02
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-08 --output-dir .atm-temp/bench-b08
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-13 --output-dir .atm-temp/bench-b13
```

Capture and bundle broker evidence:

```powershell
node --strip-types scripts/capture-broker-evidence.ts --run-dir <broker-run-dir> --team-run-dir <repo-root>/.atm/runtime/team-runs --output-dir <capture-output>
```

```powershell
node --strip-types scripts/collect-broker-evidence.ts --run-dir <broker-run-dir> --team-run-dir <repo-root>/.atm/runtime/team-runs --output-dir <bundle-output>
```

Controlled B-12 field capture after real team runs:

```powershell
node --strip-types tools/multi-vendor-broker-bench/index.ts capture-field --scenario B-12 --task TASK-TEAM-0042 --task TASK-TEAM-0043 --team-run-dir .atm/runtime/team-runs --output-dir .atm-temp/field-b12
```

## Path Resolution

Broker evidence helpers must be reusable across adopter repositories. Do not add one npm script alias per repo just to switch paths.

Current resolution order:

1. An explicit CLI argument such as `--run-dir`, `--team-run-dir`, `--output-dir`, `--log-file`, or `--atm-root`
2. The current repository's local ATM evidence/runtime paths when they exist
3. A legacy paper-era path only as a backward-compatible fallback

This means:

- `scripts/scan-broker-runs.ts` prefers `<cwd>/.atm/history/evidence/broker-runs` before falling back to the legacy paper-era run directory under `%USERPROFILE%`
- `scripts/collect-broker-evidence.ts` prefers `<cwd>/.atm/history/evidence/broker-runs` before the same legacy fallback
- `scripts/capture-broker-evidence.ts` prefers the current repo's `.atm/history/evidence/broker-runs` and `.atm/runtime/team-runs` when present before scanning historical paper locations

The legacy fallback exists only to preserve older paper-era workflows. For any new adopter repo evidence capture, pass explicit parameters so the artifact path is unambiguous and reviewable.

## Adopter Usage

Recommended minimum arguments for adopter repositories:

- `--run-dir`
- `--team-run-dir`
- `--output-dir`
- `--log-file` when generating a human-readable scan log
- `--atm-root` when the script also needs registry/runtime context

Example for an adopter repository rooted at `C:\path\to\<repo>`:

```powershell
node --strip-types scripts/scan-broker-runs.ts `
  --run-dir C:\path\to\<repo>\.atm\history\evidence\broker-runs `
  --log-file C:\path\to\<repo>\.atm\history\evidence\CID-Conflict-Run-Log.md `
  --json-output C:\path\to\<repo>\.atm\history\evidence\broker-runs-index.json
```

```powershell
node --strip-types scripts/capture-broker-evidence.ts `
  --run-dir C:\path\to\<repo>\.atm\history\evidence\broker-runs `
  --team-run-dir C:\path\to\<repo>\.atm\runtime\team-runs `
  --output-dir C:\path\to\<repo>\artifacts\broker-evidence\capture `
  --atm-root C:\path\to\<repo>\.atm
```

```powershell
node --strip-types scripts/collect-broker-evidence.ts `
  --run-dir C:\path\to\<repo>\.atm\history\evidence\broker-runs `
  --team-run-dir C:\path\to\<repo>\.atm\runtime\team-runs `
  --output-dir C:\path\to\<repo>\artifacts\broker-evidence\bundle `
  --atm-root C:\path\to\<repo>\.atm
```

If a reviewer cannot tell from the command line which repo owns the emitted artifacts, the command is underspecified and should be tightened before the evidence is cited.

## Captured Fields

- `runId`
- `planId`
- `scenario`
- `task`
- `actors`
- `vendor`
- `shared files`
- `lane`
- `verdict`
- `transactions`
- `closurePacket`
- `teamRuns`

Blocked, queued, applied, conflict, and validator-rejected outcomes are valid evidence when the broker decision is reproducible and traceable.
