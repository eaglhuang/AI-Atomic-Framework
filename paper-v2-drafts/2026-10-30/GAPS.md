# GAPS — missing evidence and experiments (2026-10-30 draft set)

Legend: **[SIGN-OFF]** = needs 文一's explicit approval (formal run, paid model run, governance/prereg change); **[AUTHOR]** = author decision, no run; **[WORK]** = engineering/analysis work, no formal run.

| # | Gap | Blocks | Type |
|---|---|---|---|
| G1 | Valid, sealed HIST-v2 stage-2 pilot (pilot-r3). Root cause done (`pilot-r2-rootcause.md`: clock discontinuity + per-writer stop vs item T_stop); dev-replay v2 already has parent/head (§40); deviations listed (v2.1 A1–A11). Remaining: build harness v4 (A8) + tests | 06c, C1′–C3′, RQ1–RQ3 | [WORK] then **[SIGN-OFF]** for pilot-r3 |
| G2 | HIST-v2 stage-3 main (steward/file_lock/textual_merge_file grid + `atm` arm at 2,000 ms window) and stage-4 held-out | 06c all tables, abstract, conclusion | **[SIGN-OFF]** |
| G3 | ~~Re-freeze decision~~ decided 2026-10-30: amend as v2.1 (`prereg-hist-v2.1-amendment.md`, 05 §5.11). Remaining: commit it to `P/benchmark-prereg/` + EVIDENCE_INDEX row | 05 §5.11 | **[SIGN-OFF]** (governance commit) |
| G4 | prereg-v3 real-agent track: v14 three-arm smoke (#311 rerun), then freeze prereg-v3 and approve formal-runs-plan-v2 (r = 3); a third arm needs a new kit; no held-out tasks run | 09, abstract | **[SIGN-OFF]** (paid model runs + freeze) |
| G5 | Proof of the §4.4 proposition (L1–L3) and an independent oracle for R(S) + property/metamorphic tests (M1) | C2, T-C3′ | [WORK] |
| G6 | Contract: main proposition on conservative contract with proof sketch (04 §4.4); PR #198 precise contract as refinement (§4.12). Remaining: confirm which rule `b1fd9d22` enforces | 04 §4.12 | [WORK] |
| G7 | Class C (true conflicts) has 1/4,095 items in classify-v8 → correct-rejection on real conflicts barely testable; decide on augmentation (e.g., synthetic C set) without breaking the prereg | RQ1 | **[AUTHOR]/[SIGN-OFF]** |
| G8 | Done (bounded): Table R12-corrected, `rescore-v1.1/` — 0 regressions all arms, 9 git_three_way indeterminate, base-validity conditional. Exact re-score needs raw test logs (not sealed) = rerun | 06b §6.2.5 | rerun would be **[SIGN-OFF]** |
| G9 | "Lost" defined paper-wide (06a); align prereg-v3 scorer before its freeze | 09 metrics | [WORK] |
| G10 | RQ4 (governance verifiability) has no measurement plan or data | RQ4 | [AUTHOR]+[WORK] |
| G11 | Crash/power-loss durability, external writers, real containers, multi-file commit — untested (stated as non-claims) | 07 | out of scope unless approved |
| G12 | Claim Plane verified on arxiv.org and added to 08 §8.1. Remaining: reason for not using AgenticFlict directly; v0.9.x↔v0.1.x version-line mapping | 08, 02 | [WORK] |
| G13 | Observability: count of file-lock fallbacks after SQLITE_BUSY (D6); evidence that the `unshare` CI test interlocks | 06a caveats | [WORK] |
| G14 | Reconcile receipt/event field list (03 §3.7) and S-label↔test mapping (04 §4.7–4.9) with PR #297 source | 03, 04 | [WORK] |
| G15 | Venue/format decision (full paper vs correction note/reproduction/experience report) | 01 §1.4, 10 | **[AUTHOR]** after G2 |

## Top 5
1. G1 harness v4 + pilot-r3 (sign-off)
2. G2 HIST-v2 main + held-out (sign-off)
3. G5 oracle/implementation conformance (G6 nearly closed)
4. G4 prereg-v3 smoke/freeze/formal runs (sign-off)
5. G3 commit v2.1 amendment (sign-off) + G7 class-C coverage
