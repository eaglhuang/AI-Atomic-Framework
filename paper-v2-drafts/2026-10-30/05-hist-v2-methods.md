# 5. Evaluation Methods: HIST-v2 Pre-Registration (as designed)

> Status: DRAFTED (methods only; **no results**). Registration: v2.0 as amended by **v2.1** (§5.11; `prereg-hist-v2.1-amendment.md`). Authoritative text: frozen directory `P/benchmark-prereg/2026-10-14-hist-v2.0/` (PR #293, merge `527426f4…`, source commit `f08599c7…`; SHA256SUMS digest `353caac6…` per `P/EVIDENCE_INDEX.md` §28). Classifier v8: PR #294, `P/benchmark-design/hist-v2-classifier-v8/RULES.md` sha256 `329165d1…c97541`, jsonschema 4.18.0. Harness v2: PR #298; smoke runbook: PR #299; coordinator: PR #297. Summary: DRAFT-zh §5. Where the harness later changed (v3), this is marked as a deviation to be recorded, not silently adopted.

## 5.1 Goal

Measure C1′–C3′ on real PR pairs with **genuine cross-writer batches**, against fair baselines that share the same atomic commit discipline, and separate functional delivery from semantic retention.

## 5.2 Item classification

Each item is a set of PR proposals against one target file. The **common base** is the maximal octopus merge-base of the PR heads; items with multiple best bases are excluded. `set_key` = sorted unique proposal ids. Categories (classifier v8):

| Class | Definition |
|---|---|
| A | all hunk distances > 3 lines; `git merge-file` clean and order-independent |
| B | some distance ≤ 3; clean |
| C | true conflict (`git merge-file` exit 1–127) |
| A′ | identical bytes (duplicate proposals) |
| B′ | clean but order-dependent |
| D | create / delete / rename (out of the supported subset) |

Plus a semantic flag S/N. Stage 0 output (sealed admission data, not a result): classify-v8 over 4,095 items → A 2,873 / A′ 10 / B 168 / C 1 / unclassified 1,043 (`P/benchmark-main/2026-10-15-hist-v2-classify-v8/`, SHA256SUMS `7895681e…`; `P/EVIDENCE_INDEX.md` §34). The C class is nearly empty (1 item), which bounds what RQ1's "correct rejection" can show on historical data (GAPS G7).

## 5.3 Arms

- **Main grid (60 runs per item):** `steward` (ATM steward path), `file_lock` (whole-file lock baseline), `textual_merge_file` (lock-protected textual three-way merge; a candidate computed outside the lock is discarded and recomputed inside it — prereg R4-D2).
- **Outside the grid:** `atm` (shared compose inbox, PR #297, `composeWindowMs` 2,000; planned 80 runs per item). Only this arm can produce `batchSize ≥ 2` and therefore test C2′.
- All arms share one whole-file lock and atomic replace. `bare_composer` is dropped; v1.1's separate `occ` and `git_three_way` arms are replaced by `textual_merge_file`.

## 5.4 Grid

2 seeds × 2 proposal orders × arrival intervals {0, 50, 100, 500, 2,000} ms with jitter `min(10 ms, 10%)` × 3 arms, with balanced arm order.

## 5.5 Scoring

- **Two separate endpoints:** functional delivery rate (`combined_success` only; late commits after timeout are not success) and accepted-change semantic retention. Not-evaluable is never scored as 0. Counts are integers.
- **Test-status mapping** keeps `skip`, `xfail`, `xfail-not-run`, `module-skip`, `xpass`, `timeout`, `killed` and `log-missing` distinct; none counts as pass (fixes v1.1 defect 3).

## 5.6 Write-safety plants

Five planted failures must each be caught by the classifier/oracle before any run counts: `lost-accepted-proposal`, `partial-apply`, `bytes-do-not-match-R(S)`, `illegal-subset`, `late-write-after-timeout` (listed as the negative controls of issue #291 "harness v2", implemented by PR #298; names in in harness v2/v3 `GENERATION.md`). Safety contract: a legal non-maximal set is insufficient progress; an illegal set or byte mismatch is a safety failure; an unnecessary rejection is not a safety failure.

## 5.7 Statistics

Unit of resampling: **shared-PR connected components**, stratified by project. Bootstrap B = 10,000 within each project, projects weighted equally (1/K). When an interval is undefined, report the point estimate under the pre-registered `point-reported-interval-undefined` policy. For zero observed events, report the one-sided Clopper–Pearson 95% upper bound `1 − 0.05^(1/n)`, n = number of components.

## 5.8 Held-out sets

A later-period historical holdout (period 2026-01-01 to 2026-09-30) and a project holdout including flask and requests; neither may be inspected before the main analysis is sealed.

## 5.9 Stages and stop rule

| Stage | Content | Gate |
|---|---|---|
| 0 | classify | done (sealed, §34) |
| 1 | smoke | ran; all formal smokes SUPERSEDED/INVALID (§35/§36) |
| 2 | pilot | **owner sign-off**; pilot-r2 stopped `inconsistent` (§41) |
| 3 | main | **owner sign-off**; not run |
| 4 | held-out | **owner sign-off**; not run |

**Stop rule:** if `steward` loses or corrupts anything, freeze and stop; the case becomes a counterexample, never offset by completion.

## 5.10 Post-freeze status notes (not results)

- Smoke and pilot v1 under harness v2 are superseded/invalid; the diagnosis (`P/benchmark-trials/2026-10-15-hist-v2-pilot-diagnosis/DIAGNOSIS_zh.md` §5–§6) forbids citing their numbers. Harness v3 (`P/benchmark-harness/hist-v2-harness-v3/`, `P/EVIDENCE_INDEX.md` §39) adds §9 jitter and mines three-way inputs; dev-replay v2 (§40) supplies `parent_text`/`head_text` for the 29 dev items. Main and held-out remain blocked (exit code 2).
- pilot-r2 (`P/benchmark-trials/2026-10-15-hist-v2-pilot-r2.NOTE.md`, §41) stopped after 747/1,740 cells on one `inconsistent:ack`: in `django:dev:17554_18450` both proposals committed, but the second writer's `first_submit` was 110.327 s after the first against a 506.5 ms designed delay, so it committed after the first writer's T_stop. Root cause (read-only analysis, `pilot-r2-rootcause.md`): a wall-clock discontinuity on the host triggered it, and the harness arms compute a per-writer stop (`own first_submit + 30 s`) instead of the item-level T_stop of prereg §3.2, which the scorer uses. Pilot-r2 numbers are pilot-only and not cited.

## 5.11 Deviations from preregistration

The registration is amended as **v2.1** (`prereg-hist-v2.1-amendment.md`, transparent-changes format; local draft pending commit). The frozen v2.0 text is not edited. Hypotheses C1–C3, endpoints, the scoring map (§5.5), the write-safety plants (§5.6), the statistics (§5.7) and the 60-cell main grid (§5.4) are **unchanged**. No main or held-out arm outcome had been observed when any change was made (exit code 2; `P/EVIDENCE_INDEX.md` L533, L573, L596, §41). Pilot data *did* inform A6–A10, as §8 of the registration allows; we disclose this.

| # | Deviation | Type | Informed by pilot data? |
|---|---|---|---|
| A1 | Classifier v7 → v8 (input-validity gates only) | procedure | no |
| A2–A4 | Batch coordinator (issue #290 → PR #297), harness v2 (issue #291 → PR #298), smoke runbook (issue #292 → PR #299) | implementation | no |
| A5 | Exploratory `atm` arm (2,000 ms window) outside the main grid; never used for C1–C3 | exploratory | no |
| A6–A7 | Harness v3: §9 jitter (missing in v2), three-way mine for text-merging arms, context mismatch → `rejected-conflict`; dev-replay v2. file_lock keeps the historical hunk (asymmetry disclosed) | conformance | yes (pilot v1, 600 `error`) |
| A8 | Harness v4 (planned): shared item T_stop, monotonic deadlines, one `effective_stop` shared by arms and scorer | conformance | yes (pilot-r2) |
| A9 | New validity rule: clock-discontinuity cells → `environment-invalid`, sealed, excluded, re-run once; stage stops if > 1% | procedure | yes (outcome-blind rule) |
| A10 | Pilot exit criterion before main: all cells, 0 `inconsistent`, 0 harness `error`, 5/5 controls caught | procedure | yes |

Pilot-r3 on harness v4, main and held-out each still require explicit author approval (§5.9).
