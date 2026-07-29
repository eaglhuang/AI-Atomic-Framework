# ATM 3.1 Paired AB/BA Governed Workload Benchmark

Generated: 2026-07-29T21:35:57.763Z
Task: ATM-GOV-0243
Verdict: pass

## Matrix

- accepted cells: 70/70
- arms: queue-only, atm-compose-first
- scales: 2, 4, 8, 16, 32, 64, 100
- contentions: disjoint, same-file-disjoint-anchor, commutative-cid, noncommutative-cid, generated-shared-surface
- repeats per AB and BA order: 3

## Metrics

- median makespan improvement: 49.3%
- active throughput improvement: 93%
- production cost ratio: 1.006
- A/A noise bound: 8.2%
- coverage: 100%

## Correctness

- negative control rejected before canonical write: true
- canonical write parallelism claim: serialized-steward-tail-only
- timing segments: proposalGenerationMs, proposalValidationMs, composePlanningMs, stewardApplyMs, sharedCommitMs

## Safety

- silent overwrite: 0
- escaped conflict: 0
- duplicate side effect: 0
- unresolved starvation: 0

## Artifacts

- Summary: artifacts/generated/atm-ab-v4/summary.json
- Cells: artifacts/generated/atm-ab-v4/cells.json
- Report: docs/reports/atm-2-1-paired-ab-v4.md
