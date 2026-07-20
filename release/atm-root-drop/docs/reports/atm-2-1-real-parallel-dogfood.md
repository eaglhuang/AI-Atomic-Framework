# ATM 2.1 Real Parallel Dogfood

Generated: 2026-07-20T18:11:09.384Z
Task: ATM-GOV-0223
Verdict: pass

## Metrics

- workerCount: 5
- maxSimultaneousWork: 5
- actualOverlapMs: 86
- parallelAdmissionCount: 4
- silentOverwrite: 0
- escapedConflict: 0
- duplicateSideEffect: 0
- unresolvedStarvation: 0

## Ticket Transitions

- requested -> parallel-admitted: 3
- requested -> compose-ticketed: 1
- requested -> conflict-ticketed: 1

## Workers

| Actor | Lane session | Scenario | Ticket state | Evidence seal |
| --- | --- | --- | --- | --- |
| dogfood-worker-01 | lane-dogfood-0223-01 | disjoint | parallel-admitted | seal-60ef8322 |
| dogfood-worker-02 | lane-dogfood-0223-02 | same-file-disjoint-anchor | parallel-admitted | seal-5ea0ea96 |
| dogfood-worker-03 | lane-dogfood-0223-03 | generated-shared-surface | compose-ticketed | seal-182dd797 |
| dogfood-worker-04 | lane-dogfood-0223-04 | disjoint | parallel-admitted | seal-7c862f42 |
| dogfood-worker-05 | lane-dogfood-0223-05 | conflict | conflict-ticketed | seal-527aa7b8 |

## Artifacts

- Summary: artifacts/generated/atm-parallel-dogfood/summary.json
- Worker manifest: artifacts/generated/atm-parallel-dogfood/workers.json
- Report: docs/reports/atm-2-1-real-parallel-dogfood.md
