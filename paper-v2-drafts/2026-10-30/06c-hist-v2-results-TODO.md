# 6.3 Results III: HIST-v2 (C1′–C3′) — BLOCKED

> Status: **BLOCKED — placeholder only.** No sealed, valid HIST-v2 run exists. Every smoke/pilot generation so far is SUPERSEDED, INVALID or pilot-only (`P/EVIDENCE_INDEX.md` §33, §35, §36, §41; `P/benchmark-trials/2026-10-15-hist-v2-pilot-diagnosis/DIAGNOSIS_zh.md` §5). Do not fill any cell from those runs.

## Planned tables and the evidence each awaits

| Placeholder | Content | Awaits |
|---|---|---|
| T-C1′ | lost / corrupted / partial / illegal-subset / late-write counts per arm; one-sided CP bound `1 − 0.05^(1/n)` over shared-PR components, per project | Stage 3 main run sealed (owner sign-off) after a valid stage 2 pilot |
| T-C2′ | distribution of observed `batchSize` in `atm`-arm coordinator receipts; share of items with ≥ 2 members committed in one batch | Same; plus the `atm` arm run with `composeWindowMs` 2,000 (80 runs/item) |
| T-C3′ | accepted set ∈ legal subsets; final bytes = R(S); `bytes-do-not-match-R(S)` = 0 | Same; independent oracle (M1) for R(S) |
| T-RQ2 | functional delivery rate, latency, retries, rejections: steward vs file_lock vs textual_merge_file, by class A/B/C and interval | Same |
| T-RQ3 | inflection by interval (0/50/100/500/2,000 ms), class and order | Same |
| T-sem | accepted-change semantic retention with separated test states | Same; re-scored scorer validated by negative controls |
| T-held | held-out (later period; flask/requests project holdout) | Stage 4 (owner sign-off), only after main is sealed |

## Preconditions before stage 2 can be re-attempted

1. Root-cause and fix the pilot-r2 `inconsistent:ack` (cell 747/1,740: proposal 18450's `first_submit` was 110.327 s after 17554's although `arrival_delay_ms` = 506.531) — a harness/scheduler defect, not yet attributed.
2. Supply parent/head texts in the dev-replay binding (DIAGNOSIS §6).
3. Record all post-freeze harness changes as deviations (05 §5.10).
4. Owner sign-off for stage 2.
