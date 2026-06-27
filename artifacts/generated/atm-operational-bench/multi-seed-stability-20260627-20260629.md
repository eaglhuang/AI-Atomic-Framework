# ATM OperationalBench Multi-Seed Stability (20260627-20260629)

OperationalBench measures ATM-local operational overhead and recovery-routing cost only. This supplementary note does not change the benchmark contract or introduce any external-system comparison.

Compared seeds: 20260627, 20260628, 20260629

Conclusion: scenario and route distributions remained identical across the tested seeds; tail latencies varied across seeds while preserving the same route and recovery structure.

Distributions identical: true
Recovery metrics identical: true

## Structural Checks

| Seed | scenarioCount | resultRows | preservedIntentSalvageRate | terminalFailClosedRate | overSerializationRate | fullRegenerationRate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20260627 | 14 | 5600 | 1 | 0.1 | 0 | null |
| 20260628 | 14 | 5600 | 1 | 0.1 | 0 | null |
| 20260629 | 14 | 5600 | 1 | 0.1 | 0 | null |

Route counts and blocked-case counts remained identical across all tested seeds by construction.

## Latency Percentiles

| Metric | 20260627 p50/p95/p99 | 20260628 p50/p95/p99 | 20260629 p50/p95/p99 |
| --- | --- | --- | --- |
| admissionDecisionMs | 0.004/0.024/0.05 | 0.005/0.025/0.048 | 0.005/0.025/0.068 |
| gitAdmitDryRunMs | 0.007/0.021/0.04 | 0.008/0.022/0.044 | 0.008/0.023/0.056 |
| stewardDryRunMs | 32.65/306.279/547.318 | 34.733/291.92/332.274 | 37.07/287.86/334.178 |
| stewardApplyMs | 33.181/302.424/541.92 | 35.901/317.522/428.165 | 37.998/302.274/323.19 |
| queueWaitMs | 0.001/0.001/0.004 | 0.001/0.002/0.003 | 0.001/0.002/0.005 |
| totalScenarioMs | 0.012/310.159/1088.094 | 0.014/559.977/845.043 | 0.014/563.52/776.279 |

Tail latencies vary most on steward-mediated paths (`stewardDryRunMs`, `stewardApplyMs`, `totalScenarioMs`), while admission and git dry-run paths remain in the same low-millisecond band across seeds.

