# ATM-AdmissionBench v0.1 — Smoke Results

- Seed: `20260625`
- Scenarios: 20
- Mode comparisons: 42
- Matched expectations: 42/42
- False-safe regressions: 0
- Unsafe-caught rate: 92.31%
- Ship-safe: yes

## Pack breakdown

| Pack | Scenarios | Comparisons |
| --- | ---: | ---: |
| agr-benchmark | 12 | 34 |
| agr-conflict-benchmark | 8 | 8 |

## Per-scenario

| Pack | Scenario | Mode | Verdict | Validator | Matched |
| --- | --- | --- | --- | --- | :---: |
| agr-benchmark | compose-disjoint-same-file | agrOff | parallel-safe | pass | ✓ |
| agr-benchmark | compose-disjoint-same-file | layer1 | parallel-safe | pass | ✓ |
| agr-benchmark | compose-disjoint-same-file | layer2Adr | parallel-safe | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-blocked | agrOff | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-blocked | layer1 | parallel-safe | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-blocked | layer2Adr | parallel-safe | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-unresolvable | agrOff | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-unresolvable | layer1 | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | compose-same-atom-cid-unresolvable | layer2Adr | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | compose-overlapping-hunks | agrOff | needs-steward | pass | ✓ |
| agr-benchmark | compose-overlapping-hunks | layer1 | needs-steward | pass | ✓ |
| agr-benchmark | compose-overlapping-hunks | layer2Adr | needs-steward | pass | ✓ |
| agr-benchmark | registry-cid-disjoint-file-overlap | agrOff | needs-physical-split | pass | ✓ |
| agr-benchmark | registry-cid-disjoint-file-overlap | layer1 | needs-physical-split | pass | ✓ |
| agr-benchmark | registry-cid-disjoint-file-overlap | layer2Adr | needs-physical-split | pass | ✓ |
| agr-benchmark | registry-shared-surface-blocked | agrOff | blocked-shared-surface | pass | ✓ |
| agr-benchmark | registry-shared-surface-blocked | layer1 | blocked-shared-surface | pass | ✓ |
| agr-benchmark | registry-shared-surface-blocked | layer2Adr | blocked-shared-surface | pass | ✓ |
| agr-benchmark | registry-read-write-dependency | agrOff | parallel-safe | pass | ✓ |
| agr-benchmark | registry-read-write-dependency | layer1 | parallel-safe | pass | ✓ |
| agr-benchmark | registry-read-write-dependency | layer2Adr | serial | pass | ✓ |
| agr-benchmark | registry-parallel-safe-clean | agrOff | parallel-safe | pass | ✓ |
| agr-benchmark | registry-parallel-safe-clean | layer1 | parallel-safe | pass | ✓ |
| agr-benchmark | registry-parallel-safe-clean | layer2Adr | parallel-safe | pass | ✓ |
| agr-benchmark | compose-shared-validator-surface | agrOff | parallel-safe | pass | ✓ |
| agr-benchmark | compose-shared-validator-surface | layer1 | parallel-safe | pass | ✓ |
| agr-benchmark | compose-shared-validator-surface | layer2Adr | parallel-safe | pass | ✓ |
| agr-benchmark | validator-catch-typecheck-failure | agrOff | parallel-safe | fail | ✓ |
| agr-benchmark | validator-catch-typecheck-failure | layer2Adr | parallel-safe | fail | ✓ |
| agr-benchmark | layer1-no-refinement-available | agrOff | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | layer1-no-refinement-available | layer1 | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | layer2-threshold-not-met | agrOff | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | layer2-threshold-not-met | layer1 | blocked-cid-conflict | pass | ✓ |
| agr-benchmark | layer2-threshold-not-met | layer2Adr | blocked-cid-conflict | pass | ✓ |
| agr-conflict-benchmark | parallel-safe-disjoint | conflict | allow-parallel | pass | ✓ |
| agr-conflict-benchmark | read-write-dependency-freeze | conflict | allow-with-watch | fail | ✓ |
| agr-conflict-benchmark | capsule-cid-drift-freeze | conflict | freeze | pass | ✓ |
| agr-conflict-benchmark | shared-surface-blocked | conflict | freeze | pass | ✓ |
| agr-conflict-benchmark | cid-conflict-blocked | conflict | freeze | pass | ✓ |
| agr-conflict-benchmark | physical-overlap-steward | conflict | freeze | pass | ✓ |
| agr-conflict-benchmark | orphan-lock-cleanup | conflict | orphan-cleanup-recover | pass | ✓ |
| agr-conflict-benchmark | manual-override-collision | conflict | deny-and-reroute | pass | ✓ |
