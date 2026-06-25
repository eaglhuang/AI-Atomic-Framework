# ATM-AdmissionBench v0.2 — Paper Tables

Seed: `20260625` · Contract: v0.2 · Track: `all` · Primary denominator: 42 mode-comparisons (unresolved set excluded).

## Table 1 — Policy Comparison

| Policy | Scenarios | False-safe | Over-serialization | Route F1 | Intent preservation | p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| direct | 42 | 17 | 0 | 0.5763 | 100.00% | not-measured |
| git-diff3 | 42 | 14 | 0 | 0.6452 | 100.00% | not-measured |
| file-serial | 42 | 6 | 6 | 0.4151 | 100.00% | not-measured |
| file-occ | 42 | 6 | 6 | 0.5 | 100.00% | not-measured |
| text-range | 42 | 14 | 0 | 0.5517 | 100.00% | not-measured |
| atm-full | 42 | 2 | 4 | 1 | 97.62% | not-measured |

## Table 2 — Ablation

| Variant | Δ false-safe | Δ over-serialization | Δ E2E success | Main affected families |
| --- | ---: | ---: | ---: | --- |
| no-cid | 3 | 0 | -4 | cid-conflict |
| no-shared-surface | 3 | 0 | -4 | shared-surface |
| no-rw-dependency | 1 | 0 | -1 | rw-dependency |
| no-virtual-atom | 8 | 0 | -9 | physical-overlap |
| no-conflict-key | 4 | 0 | -5 | rw-dependency; shared-surface |
| no-cas | 3 | 0 | -5 | capsule-drift; cid-conflict |
| no-fallback-lock | 0 | 0 | -2 | manual-override; orphan-lock |

## Table 3 — Enforcement and Trust Boundary

| Condition | Admission caught | Apply caught | Validator caught | Silent miss | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| unsafe-input | 18 | 3 | 0 | 0 | 25 |
| safe-input | 0 | 0 | 3 | 2 | 17 |
| mixed | 0 | 0 | 0 | 0 | 0 |
| adversarial-input | 0 | 0 | 0 | 0 | 0 |

Forwarding summary: admission-forwarded=9 (→apply 6, →validator 3, →human 0); not-forwarded=33. Field evidence source: not-applicable. Field evidence mixed into policy baseline denominator: no.
