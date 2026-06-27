# ATM OperationalBench v0.1 Paper Table

OperationalBench is an ATM Bench family member and the operational-overhead sibling of AdmissionBench. It measures ATM-local overhead only; it does not compare ATM with CoAgent, S-Bus, CodeTeam, or any external system.

Validator cost is listed independently as `validatorMs`. Fail-closed means fail-closed to unsafe direct or parallel apply, not discarding preserved intent.

| Metric | Count | Min ms | Mean ms | Stddev ms | P50 ms | P95 ms | P99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| diffConstructionMs | 2000 | 0.001 | 0.001 | 0.006 | 0.001 | 0.001 | 0.001 | 0.260 |
| mutationRequestConstructionMs | 5600 | 0.001 | 0.004 | 0.010 | 0.004 | 0.008 | 0.015 | 0.323 |
| admissionDecisionMs | 3600 | 0.002 | 0.009 | 0.020 | 0.005 | 0.025 | 0.068 | 0.343 |
| composerPlanMs | 1200 | 0.006 | 0.014 | 0.020 | 0.010 | 0.024 | 0.052 | 0.465 |
| stewardDryRunMs | 400 | 30.029 | 60.863 | 74.550 | 37.070 | 287.860 | 334.178 | 402.768 |
| stewardApplyMs | 400 | 31.242 | 66.620 | 81.771 | 37.998 | 302.274 | 323.190 | 400.299 |
| validatorMs | 5600 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.002 | 0.048 |
| gitAdmitDryRunMs | 2000 | 0.001 | 0.010 | 0.022 | 0.008 | 0.023 | 0.056 | 0.379 |
| casMismatchRecoveryMs | 2000 | 0.001 | 0.002 | 0.002 | 0.002 | 0.004 | 0.010 | 0.045 |
| queueWaitMs | 400 | 0.001 | 0.001 | 0.002 | 0.001 | 0.002 | 0.005 | 0.029 |
| totalScenarioMs | 5600 | 0.007 | 43.436 | 169.172 | 0.014 | 563.520 | 776.279 | 2343.494 |

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
