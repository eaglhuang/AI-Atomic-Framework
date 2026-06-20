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
