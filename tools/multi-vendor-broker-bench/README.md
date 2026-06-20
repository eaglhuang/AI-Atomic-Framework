# Multi-Vendor Broker Bench

This tool produces paper evidence for ATM broker behavior without changing the broker evidence schema.

## Synthetic Runs

```powershell
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-02 --output-dir .atm-temp/bench-b02
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-08 --output-dir .atm-temp/bench-b08
node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-13 --output-dir .atm-temp/bench-b13
```

Each run writes an `atm.brokerOperationRunRecordEnvelope.v1` file under `<output-dir>/runs/`.
Scenario identity stays in `request_identity` using `bench:<scenario>:<taskId>:<slug>`.

## Field Capture

```powershell
node --strip-types tools/multi-vendor-broker-bench/index.ts capture-field --scenario B-12 --task TASK-TEAM-0042 --task TASK-TEAM-0043 --team-run-dir .atm/runtime/team-runs --output-dir .atm-temp/field-b12
```

Field capture is post-run capture. It writes a manifest, then delegates reporting to `scripts/collect-broker-evidence.ts`.
