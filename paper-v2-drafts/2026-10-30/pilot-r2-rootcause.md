# HIST-v2 pilot-r2 `inconsistent:ack`: read-only root-cause analysis

> Status: ANALYSIS (2026-10-30). Read-only on sealed files; **pilot was not re-run**, no harness code changed. Sealed directory: `P/benchmark-trials/2026-10-15-hist-v2-pilot-r2/` (SHA256SUMS `e44080d1…e6d9`, `P/EVIDENCE_INDEX.md` §41). Harness: `P/benchmark-harness/hist-v2-harness-v3/` (H/ below). Scorer: `P/benchmark-design/hist-v2-classifier-v8/src/hist_v2_classify_v8/score.py`. Runner: `P/benchmark-design/hist-v2-pilot-r2/src/hist_v2_pilot_r2/runner.py`. Times are Asia/Taipei (UTC+8) unless marked.

## 1. What was observed

Counterexample cell (index 746, the 747th of 1,740 planned; the runner stops on a counterexample, `runner.py:385–387`; `STOP_REPORT.md` "已執行格子 747"):
`raw/cells/django_dev_17554_18450_django_db_models_fields_related_descriptors.py__textual_merge_file__reverse__500__s0/` and `forensics/0746-inconsistent.json`.

| Writer | designed `arrival_delay_ms` | first_submit (epoch s) | rename | ack | lock wait | retries |
|---|---:|---:|---:|---:|---:|---:|
| 17554 | 7.7787 | 1792062620.7095 | 620.7946 | 620.7950 | 0.005 ms | 0 |
| 18450 | 506.5312 | 1792062731.0361 | 731.6332 | 731.6391 | 0.025 ms | 0 |

Submit spread 110.327 s against a designed spread of ≈0.499 s (job/result JSONs in the cell directory). Across all 747 executed cells this is the **only** cell whose submit spread exceeds its designed delay by more than 1 s; every other 500 ms cell has spread ≤ 0.516 s; gaps between consecutive cells ≤ 0.627 s (median 0.474 s). The run spans 1792061760.14 → 1792062731.64 (971.5 s; 2026-10-15 18:56:00 → 19:12:11 Taipei). (Computed from `raw/cells/*/results/*.json` and `manifest.json`.)

Arm verdict for 18450: `committed` / `acked-in-window` (its own first_submit + 30 s). Scorer verdict: `late-commit-after-timeout` / `rename-after-stop` (item stop = earliest first_submit + 30 s = 620.71 + 30). The disagreement is the `inconsistent:ack` counterexample.

## 2. Mechanism (two independent defects)

**D1 — trigger: a ~110 s wall-clock discontinuity, not scheduler work.**
- Writers pass a two-process barrier (`H/barrier.py:10–11`, ready files, 10 s timeout on `time.monotonic`), then `time.sleep(scheduled_delay_seconds(job))` (`H/worker.py`), then `run_textual` immediately records `budget.open_first(WallClock.now())`, where `WallClock.now()` is `time.time()` (`H/clock.py:13`).
- 17554 could leave the barrier only after both ready files existed, i.e. by ≈620.70. So 18450 also left the barrier by ≈620.70 (+10 s at most, the monotonic timeout). Between barrier exit and its first_submit at 731.04 there is only `sleep(0.5065)`.
- A 110 s stall of the 18450 process alone is excluded: the driver waits with `process.communicate(timeout=40)` (`H/driver.py:101,156`, monotonic). A real stall that long would have raised `subprocess.TimeoutExpired`, which the runner does not catch (`runner.py:373` catches only `OSError, RuntimeError, KeyError`), so the run would have crashed instead of sealing the cell with full results.
- Hence `CLOCK_REALTIME` advanced ≈110 s more than `CLOCK_MONOTONIC` during that sleep. Consistent explanations: a host/VM pause or snapshot followed by a wall-clock resync (step), or an NTP/chrony step. The sealed data do not contain kernel/chrony logs, so these cannot be fully separated. It is an **environment event**, isolated to one cell out of 747.

**D2 — exposure: the harness does not implement the pre-registered item stop.**
- Prereg v2.0 §3.2 (`P/benchmark-prereg/2026-10-14-hist-v2.0/HIST_BENCH_V2_PREREG_r7_zh.md` L96–98): when any proposal's 30 s expires, **all writers of the item stop** (T_stop); each proposal's effective stop is min(own first submit + 30 s, T_stop).
- Harness v3 arms compute only the per-writer deadline: `item_stop = budget.first_submit + DEADLINE_SECONDS` (`H/textual.py:38`, `H/file_lock_arm.py:18`, `H/steward.py:29`). Each process measures its own `time.time()`; no shared T_stop is passed to writers.
- The scorer applies the prereg rule: `H/scoring.py:105` (`_item_stop` = min first_submit + 30) and classifier v8 `score.py:457–512` (`effective_stop = min(own_deadline, item_stop)`).
- With normal spreads (< 1 s) the two definitions never disagree, so smoke and dev replay could not expose D2. D1 created a > 30 s spread, and D2 turned it into an arm/scorer contradiction. The scorer behaved as pre-registered; the harness did not.

**Conclusion.** Root cause = D2 (protocol non-conformance of harness v3: no shared item stop, wall-clock deadlines measured per process), triggered by D1 (a one-off wall-clock/VM time discontinuity on the box). Neither is an ATM (steward) defect: the cell is a `textual_merge_file` cell, and the lock waits were 0.005/0.025 ms with 0 retries.

## 3. Recommended fix (harness v4; not implemented here)

1. **Shared item clock.** The driver fixes `item_t0` (monotonic, at barrier release) and passes it to every writer; every arm enforces `effective_stop = min(first_submit + 30, T_stop)` with T_stop = earliest first submit + 30, published through a shared file in the cell workspace; writers check it before each submit, retry and rename (prereg §3.2 L96).
2. **Monotonic intervals.** All deadline arithmetic on `time.monotonic_ns()` (system-wide on Linux, comparable across processes on one boot; or `CLOCK_BOOTTIME` if suspend must count). Keep `time.time()` only as a logged label.
3. **Dual-clock record + validity rule.** Log (realtime, monotonic) at barrier exit, first submit, rename and ack for every writer. If |Δrealtime − Δmonotonic| > 1 s inside a cell, or the observed submit spread exceeds the designed delay by > 1 s, mark the cell `environment-invalid:clock-discontinuity`, keep it sealed and listed, exclude it from all counts, and re-run that cell once with the same seed (pre-declared in prereg v2.1 §A3; see `prereg-hist-v2.1-amendment.md`).
4. **Arm/scorer single source.** Arms call the same `effective_stop` function the scorer uses (import from one module), so a future mismatch is a test failure, not a pilot counterexample.
5. **Tests.** ManualClock tests: (a) second writer arriving 31 s after the first must stop with `timeout/item-stop`; (b) an injected +110 s realtime step with monotonic unchanged must not change any verdict and must set the clock-discontinuity flag; (c) arm and scorer verdicts agree on every negative-control cell.
6. **Box hygiene for stage 2.** Record `chronyc tracking`/`timedatectl` before and after the run in `pins-observed.json`; avoid box snapshots during the run.

## 4. What this does and does not change

- The 747 executed pilot-r2 cells remain a **pilot** (prereg §8 stage 2: "不進正式結果"). Their counts are not paper results.
- No main or held-out run exists; both remain at exit code 2 (`P/EVIDENCE_INDEX.md` §36–§41).
- A pilot-r3 on harness v4 needs 文一's explicit approval (prereg §8). **Not run.**
