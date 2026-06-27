# ATM OperationalBench v0.1 Paper Table

OperationalBench is an ATM Bench family member and the operational-overhead sibling of AdmissionBench. It measures ATM-local overhead only; it does not compare ATM with CoAgent, S-Bus, CodeTeam, or any external system.

Validator cost is listed independently as `validatorMs`. Fail-closed means fail-closed to unsafe direct or parallel apply, not discarding preserved intent.

| Metric | Count | Min ms | Mean ms | Stddev ms | P50 ms | P95 ms | P99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| diffConstructionMs | 2000 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.020 |
| mutationRequestConstructionMs | 5600 | 0.001 | 0.004 | 0.012 | 0.004 | 0.008 | 0.018 | 0.381 |
| admissionDecisionMs | 3600 | 0.002 | 0.009 | 0.022 | 0.005 | 0.025 | 0.048 | 0.743 |
| composerPlanMs | 1200 | 0.006 | 0.016 | 0.028 | 0.010 | 0.028 | 0.158 | 0.445 |
| stewardDryRunMs | 400 | 29.199 | 59.593 | 78.624 | 34.733 | 291.920 | 332.274 | 546.428 |
| stewardApplyMs | 400 | 29.756 | 77.008 | 113.342 | 35.901 | 317.522 | 428.165 | 1009.199 |
| validatorMs | 5600 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.002 | 0.036 |
| gitAdmitDryRunMs | 2000 | 0.001 | 0.011 | 0.050 | 0.008 | 0.022 | 0.044 | 2.147 |
| casMismatchRecoveryMs | 2000 | 0.001 | 0.002 | 0.006 | 0.002 | 0.003 | 0.007 | 0.263 |
| queueWaitMs | 400 | 0.001 | 0.001 | 0.001 | 0.001 | 0.002 | 0.003 | 0.020 |
| totalScenarioMs | 5600 | 0.007 | 46.978 | 202.374 | 0.014 | 559.977 | 845.043 | 3770.192 |

| Recovery Metric | Value | Note |
| --- | ---: | --- |
| preservedIntentSalvageRate | 1.0000 | Preserved intent after recovery routing |
| terminalFailClosedRate | 0.1000 | Fail-closed to unsafe direct/parallel apply |
| overSerializationRate | 0.0000 | Explicit over-serialization observations |
| fullRegenerationRate | null | not observed by this harness |

| Blocked Case | Rows |
| --- | ---: |
| none | 1600 |
| queue | 400 |
| rebase-replay | 1200 |
| refinement | 400 |
| serialization | 1200 |
| steward-review | 400 |
| terminal-fail-closed | 400 |
