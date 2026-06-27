# ATM OperationalBench v0.1 Paper Table

OperationalBench is an ATM Bench family member and the operational-overhead sibling of AdmissionBench. It measures ATM-local overhead only; it does not compare ATM with CoAgent, S-Bus, CodeTeam, or any external system.

Validator cost is listed independently as `validatorMs`. Fail-closed means fail-closed to unsafe direct or parallel apply, not discarding preserved intent.

| Metric | Count | Min ms | Mean ms | Stddev ms | P50 ms | P95 ms | P99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| diffConstructionMs | 7500 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.036 |
| mutationRequestConstructionMs | 21000 | 0.001 | 0.003 | 0.007 | 0.003 | 0.007 | 0.013 | 0.361 |
| admissionDecisionMs | 13500 | 0.002 | 0.008 | 0.025 | 0.003 | 0.026 | 0.045 | 1.774 |
| composerPlanMs | 4500 | 0.005 | 0.013 | 0.028 | 0.007 | 0.025 | 0.045 | 0.777 |
| stewardDryRunMs | 1500 | 28.266 | 66.495 | 102.138 | 34.616 | 298.934 | 353.622 | 1320.919 |
| stewardApplyMs | 1500 | 28.368 | 67.059 | 100.398 | 35.366 | 299.757 | 341.281 | 1521.322 |
| validatorMs | 21000 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.002 | 0.126 |
| gitAdmitDryRunMs | 7500 | 0.001 | 0.008 | 0.020 | 0.007 | 0.017 | 0.036 | 0.665 |
| casMismatchRecoveryMs | 7500 | 0.001 | 0.002 | 0.003 | 0.001 | 0.003 | 0.006 | 0.186 |
| queueWaitMs | 1500 | 0.001 | 0.002 | 0.011 | 0.001 | 0.002 | 0.006 | 0.420 |
| totalScenarioMs | 21000 | 0.006 | 43.363 | 191.400 | 0.011 | 355.455 | 756.083 | 3914.241 |

| Recovery Metric | Value | Note |
| --- | ---: | --- |
| preservedIntentSalvageRate | 1.0000 | Preserved intent after recovery routing |
| terminalFailClosedRate | 0.1000 | Fail-closed to unsafe direct/parallel apply |
| overSerializationRate | 0.0000 | Explicit over-serialization observations |
| fullRegenerationRate | null | not observed by this harness |

| Blocked Case | Rows |
| --- | ---: |
| none | 6000 |
| queue | 1500 |
| rebase-replay | 4500 |
| refinement | 1500 |
| serialization | 4500 |
| steward-review | 1500 |
| terminal-fail-closed | 1500 |
