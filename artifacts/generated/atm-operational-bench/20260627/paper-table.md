# ATM OperationalBench v0.1 Paper Table

OperationalBench is an ATM Bench family member and the operational-overhead sibling of AdmissionBench. It measures ATM-local overhead only; it does not compare ATM with CoAgent, S-Bus, CodeTeam, or any external system.

Validator cost is listed independently as `validatorMs`. Fail-closed means fail-closed to unsafe direct or parallel apply, not discarding preserved intent.

| Metric | Count | Min ms | Mean ms | Stddev ms | P50 ms | P95 ms | P99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| diffConstructionMs | 2000 | 0.001 | 0.001 | 0.005 | 0.001 | 0.001 | 0.001 | 0.205 |
| mutationRequestConstructionMs | 5600 | 0.001 | 0.004 | 0.010 | 0.003 | 0.007 | 0.017 | 0.353 |
| admissionDecisionMs | 3600 | 0.002 | 0.008 | 0.017 | 0.004 | 0.024 | 0.050 | 0.406 |
| composerPlanMs | 1200 | 0.005 | 0.016 | 0.027 | 0.009 | 0.028 | 0.180 | 0.337 |
| stewardDryRunMs | 400 | 28.470 | 70.052 | 116.617 | 32.650 | 306.279 | 547.318 | 799.380 |
| stewardApplyMs | 400 | 29.555 | 69.002 | 108.352 | 33.181 | 302.424 | 541.920 | 776.902 |
| validatorMs | 5600 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.002 | 0.069 |
| gitAdmitDryRunMs | 2000 | 0.001 | 0.010 | 0.020 | 0.007 | 0.021 | 0.040 | 0.330 |
| casMismatchRecoveryMs | 2000 | 0.001 | 0.002 | 0.002 | 0.002 | 0.003 | 0.006 | 0.079 |
| queueWaitMs | 400 | 0.001 | 0.002 | 0.010 | 0.001 | 0.001 | 0.004 | 0.191 |
| totalScenarioMs | 5600 | 0.007 | 44.975 | 206.097 | 0.012 | 310.159 | 1088.094 | 3376.660 |

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
