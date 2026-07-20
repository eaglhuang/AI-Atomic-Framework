# ATM 2.1 Paired AB v4

Generated: 2026-07-20T18:26:03.097Z
Task: ATM-GOV-0224
Verdict: pass

## Matrix

- cells: 420/420
- arms: serial, queue-only, atm-compose-first, isolated-git-branch-merge
- scales: 2, 4, 8, 16, 32, 64, 100
- contentions: disjoint, same-file-disjoint-anchor, commutative-cid, noncommutative-cid, generated-shared-surface
- repeats: 1, 2, 3

## Metrics

- median makespan improvement: 35.8%
- active throughput improvement: 56%
- production cost ratio: 1.06
- coverage: 100%

## Safety

- controller verdict: pass
- fallback mode: queue-only
- reset eligible: true
- evidence digest: sha256:7811c0cee0383a4888f665a638aec13e8c77b517edaf62719033468cc320e7c9
- silent overwrite: 0
- escaped conflict: 0
- duplicate side effect: 0
- unresolved starvation: 0

## Task Summary

- window: 2026-07-20T18:00:00.000Z/2026-07-20T19:00:00.000Z
- watermark: atm-ab-v4-watermark-420-cells
- sealed digest: sha256:136270476829cbd4efaf18b00c56fe5b0c265984f9cfefa8a9d0aa0ddea001d6

## Artifacts

- Summary: artifacts/generated/atm-ab-v4/summary.json
- Cells: artifacts/generated/atm-ab-v4/cells.json
- Report: docs/reports/atm-2-1-paired-ab-v4.md
