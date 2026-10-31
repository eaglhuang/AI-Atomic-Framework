# HIST-v2 pre-registration — Amendment v2.1 (transparent changes after the v2.0 freeze)

> Status: **AMENDMENT DRAFT, local** (2026-10-30). Decision to amend rather than re-draft: 文一, 2026-10-30 ("直接升級 2.1"). Not committed; the repo's governance record (`P/benchmark-prereg/`, `P/EVIDENCE_INDEX.md`) is unchanged until 文一 commits it. Format follows OSF "transparent changes" practice: the frozen v2.0 document is not edited; this amendment lists every post-freeze change with timing, rationale and whether any data informed it. `P/` = `research/paper-v2/` at repo main `ccea864`. Times: Asia/Taipei (UTC+8), UTC in brackets.

## 0. Frozen registration this amendment refers to

| Item | Value | Source |
|---|---|---|
| Registration | HIST-v2 pre-registration **v2.0** ("只凍結方法設計"; classification and experiments remain gated) | `P/EVIDENCE_INDEX.md` §28 |
| Freeze commit | `5dcef16e401f92ba40310f61ac387ba6676fef48`, 2026-10-14 23:10:30 [15:10:30Z] | `git log 5dcef16e40` |
| Merged as | PR #293, merge `527426f487`, 2026-10-14 23:30:30 [15:30:30Z] | `git log 527426f487` |
| Source commit (design r7 + classifier v7) | `f08599c7d864cd4ede0b50e4c6b6742b4a892f0b` | §28 |
| Directory | `P/benchmark-prereg/2026-10-14-hist-v2.0/` (5 files + SHA256SUMS) | §28 |
| SHA256SUMS sha256 | `353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec` | re-computed 2026-10-30, matches §28 |
| `HIST_BENCH_V2_PREREG_r7_zh.md` | `a4030f9b7606ae724aaf89b8e9d6186759ab146869632d9def3bb2b6df6a3a55` | re-computed, matches §28 |
| `DECISIONS.md` | `e6fd756c5d48f77a242691c6a4fc62ca34ed53ccd37c4162cd994e7190c38ee8` | re-computed, matches §28 |
| `README.md` | `21bd33c54c017b5355674d7716ec90fb0b5a45b3861d8cf37858e21424221d70` | re-computed, matches §28 |
| Classifier v7 `RULES.md` | `4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0` | §28 |

## 1. What does NOT change

- **Claims / hypotheses C1–C3** (prereg §1), file-and-fault model, and the non-claims: unchanged.
- **Endpoints and scoring** (§3.2 terminal table, §5 functional delivery and semantic preservation, the status map with skip/xfail/xfail-not-run/module-skip/xpass/timeout/killed/log-missing as distinct states, negative-control requirement): unchanged.
- **Statistics** (§6: component-level upper bounds, independence assumption, no proposal-level failure rate): unchanged.
- **Main grid** (§7: steward, file_lock, textual_merge_file; 2 seeds × 2 orders × 5 intervals × 3 arms = 60 cells per item) and secondary factors: unchanged.
- **Stage gates** (§8: smoke → pilot → main → held-out, each with explicit author approval; pilot "不進正式結果"; "找到 bug 就開新版本，不在原封存上修"): unchanged and still binding.

## 2. Data seen before each change (evidence-checked)

| Data | Seen? | Evidence |
|---|---|---|
| Main (stage 3) HIST-v2 outcomes | **No.** Never run. `--stage main` hard-refuses (exit code 2) | `P/EVIDENCE_INDEX.md` L533, L573, L596, §41 header ("沒有主跑，沒有留出集"); no HIST-v2 main directory under `P/benchmark-main/` (only `2026-10-15-hist-v2-classify-v8/`, `2026-10-15-hist-v2-dev-replay-v2/`) |
| Held-out (stage 4) outcomes | **No.** Never run; exit code 2. Held-out rows are refused by the pilot runner (213 rejected in pilot-r2) | same; `P/benchmark-trials/2026-10-15-hist-v2-pilot-r2/STOP_REPORT.md` "拒絕的留出列：213" |
| Held-out **labels** (classification only, no arm) | Yes — classifier v8 labelled all 4,095 candidates incl. held-out | `P/EVIDENCE_INDEX.md` §34. Labels carry no arm outcome; disclosed |
| Smoke outcomes (stage 1) | Yes (2026-10-15; later SUPERSEDED) | §35 |
| Pilot v1 outcomes (stage 2, harness v2; 1,740 cells, 29 dev items; 600 `error` records) | **Yes — informed A6/A7** | §36, §38 (`DIAGNOSIS_zh.md`) |
| Pilot-r2 outcomes (harness v3; 747/1,740 cells; 1 `inconsistent:ack`) | **Yes — informed A8/A9/A10** | §41; `pilot-r2-rootcause.md` |

Pilot data informing harness fixes is permitted by §8 (pilot exists to find bugs; its counts never enter results). We disclose it rather than claim the changes were blind. No change below alters a hypothesis, an endpoint definition, or the analysis plan in response to outcome data.

## 3. Changes after the freeze

Category key: **I** = implementation of a frozen rule (no method change); **C** = conformance fix (code did not implement a frozen rule); **E** = addition/clarification of procedure (new rule, method unchanged); **X** = exploratory addition outside confirmatory analysis.

| # | Change | When (commit / PR) | Cat. | Rationale | Informed by outcome data? |
|---|---|---|---|---|---|
| A1 | Stage-0 classifier **v7 → v8** (admission gates: NUL-separated path lists, special filenames, pin to prereg v2.0, `jsonschema==4.18.0`); RULES sha256 `329165d1…c97541` | 2026-10-14 23:19 [15:19Z], `4f7b9f7a20`; PR #294 merge `3ec951fca2` 23:45 | E | §28 states v7 must not produce formal classification; v8 adds input-validity gates only, label rules from r7 retained | No (static review; before any classification run) |
| A2 | ATM core cross-writer **batch coordinator** implemented to §4 minimum contract | issue #290 → PR #297, merge `cb25242433`, 2026-10-15 01:08 [10-14 17:08Z] | I | Steward arm needs the coordinator §4 specifies | No |
| A3 | **Harness v2** (atomic textual_merge_file, unified deadline, multi-session driver, combined_success, five planted negative controls) | issue #291 → PR #298 `aecb596cef`, 2026-10-15 02:07 | I | Executes §3, §5 | No |
| A4 | **Smoke runbook** and approval tokens; smoke executed and sealed | issue #292 → PR #299 `ae342aace6` (10-15 02:51); PR #301 (07:34), #302 classify-v8 items (09:11), #303 smoke (09:52) | I | §8 stage 1 | No (smoke outcomes did not change method) |
| A5 | Harness carries an extra **`atm` arm** (`composeWindowMs` 2000 ms, 80 cells/item), outside the 60-cell main grid; not run in any pilot | harness v2/v3 README | X | Secondary description of the full ATM path; §7 main grid unchanged | No. **Declared exploratory**: never used for C1–C3 tests or arm rankings |
| A6 | **Harness v3**: (a) §9 uniform jitter `[0, min(10 ms, 10% of interval))`, seed `hist-v2-jitter:<seed>:<fixture>:<order>:<interval>:<writer>` — v2 had none; (b) three-way mine `git merge-file(base, parent, head)` for textual_merge_file/steward/atm when the proposal carries parent/head text; (c) context mismatch → `rejected-conflict` instead of `error`. file_lock keeps the historical hunk | `c8d6f4c672`, PR #306 merge `6040214238`, 2026-10-15 19:12 [11:12Z]; SHA256SUMS `07a8f10f…a59` | C (a), C (b, c) | (a) §9 required jitter; (b, c) the v2 hunk applier turned legitimate context drift into tool errors, contradicting §3.2's `error` = tool/process fault | **Yes — pilot v1** (600 `error` records; §38) |
| A7 | **Dev replay bindings v2** (`hist-v2-dev-replay/2`: adds `parent_text`, `head_text` for the same 29 dev items) | `7c5dd880a6`, PR #307 merge `54c03c5b15`, 2026-10-15 19:57 | I | Needed by A6(b) | Yes — pilot v1 (same diagnosis) |
| A8 | **Harness v4 (pre-declared, not yet built)**: shared item stop T_stop published to all writers; all deadline arithmetic on `CLOCK_MONOTONIC`; arms and scorer call one `effective_stop` function; dual-clock logging | this amendment | C | §3.2 L96–98 requires all writers of an item to stop at T_stop; v3 arms use only `own first_submit + 30 s` (`textual.py:38`, `file_lock_arm.py:18`, `steward.py:29`) | **Yes — pilot-r2** (cell 746 `inconsistent:ack`; `pilot-r2-rootcause.md`) |
| A9 | **Environment-validity rule (new)**: a cell is `environment-invalid:clock-discontinuity` if within it |Δrealtime − Δmonotonic| > 1 s, or observed submit spread exceeds designed delay by > 1 s. Such cells are sealed and listed, excluded from every count, and re-run once with identical seed/order/interval; a second hit is reported as a harness failure. If > 1% of a stage's cells are invalid, the stage stops and is reported | this amendment | E | Pre-declares, before any main run, how an infrastructure time event is handled, instead of ad-hoc exclusion | Yes — pilot-r2 (1 of 747 cells). Rule is outcome-blind: it reads only clocks, never arm verdicts |
| A10 | **Pilot exit criterion (new, conservative)**: main may be requested only after one pilot on the final harness completes all planned cells with 0 `inconsistent`, 0 harness `error`, all five negative controls caught | this amendment | E | §8 had no pilot pass criterion; makes the gate auditable | Yes — pilot v1/r2 failures |
| A11 | Prior pilot/smoke generations labelled SUPERSEDED/INVALID; their counts are never cited as results | §35/§36/§38/§41 | E | §8 | n/a |

## 4. v2.0 → v2.1 diff (method-level view)

| Section of v2.0 | v2.0 text (summary) | v2.1 | Changed? |
|---|---|---|---|
| §1 claims C1–C3 | as frozen | as frozen | No |
| §2 classes, held-out | classifier v7 | classifier v8 (A1); same classes A/A′/B/B′/C/D; held-out untouched by arms | Tool version only |
| §3 deadline 30 s, retries | per-proposal 30 s incl. all waits | same | No |
| §3.2 T_stop for all writers | required | required; harness v4 must implement it (A8) | No (implementation fixed) |
| §3.2 `error` terminal | tool/process error | same; context drift is `rejected-conflict` (A6c), consistent with §3.2 | Clarified |
| §4 coordinator contract | minimum contract | implemented (A2) | No |
| §5 scoring, test-state map | as frozen | as frozen | No |
| §6 statistics | as frozen | as frozen | No |
| §7 arms / 60-cell grid | 3 main arms | 3 main arms; `atm` exploratory only (A5) | Addition (exploratory) |
| §8 stages | gates + approvals | same + pilot exit criterion (A10) + validity rule (A9) | Addition (procedure) |
| §9 jitter | required | implemented in v3 (A6a) | No (implementation fixed) |
| §9 mining | historical replay | three-way mine for text-merging arms when parent/head known (A6b); file_lock keeps historical hunk | Implementation detail; disclosed as asymmetry |

## 5. Remaining steps (all require 文一's approval)

1. Commit this amendment as `P/benchmark-prereg/<date>-hist-v2.1/` with SHA256SUMS, plus an EVIDENCE_INDEX row (governance record; not done here).
2. Build harness v4 (A8) with the tests in `pilot-r2-rootcause.md` §3.5 — engineering, no run.
3. Pilot-r3 on harness v4 (stage 2) — **[SIGN-OFF]**.
4. Main (stage 3) and held-out (stage 4) — **[SIGN-OFF]** each.

## Addendum 2026-10-31 — proposed, NOT adopted

- **A12 (proposed)** host-pause validity: pilot-r3 attempt 1 stopped on a whole-VM pause in which realtime and monotonic advanced together (~146 s), invisible to A9. Proposal: a driver heartbeat samples monotonic every 100 ms; a gap > 1 s inside a cell labels it `environment-invalid:host-pause`, handled exactly like A9 (sealed, excluded, re-run once, > 1 % stops the stage). Outcome-blind (reads only clocks). Needs harness v5 + tests, then author sign-off. Attempt 1 stays a failed pilot under current rules.
- **A13 (proposed)** main-run resumability and storage: checkpoint by cell index; raw cells archived per shard (tar.gz + SHA256SUMS), summaries/observations in git, archives off-git with hashes in git.
