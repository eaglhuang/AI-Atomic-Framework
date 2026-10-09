# DEVIATIONS — HIST trial pilot 2026-10-09

## Deviations from HISTORICAL_BENCH_PREREG_zh.md v0.1 (shared by smoke and pilot; times Asia/Taipei)

1. **2026-10-09 17:20 — PR base without merge_commit_sha.** Prereg §3.1(4) defines mb_X = merge-base(head_X, landing_X^1).
   Mining used the unauthenticated GitHub Search API (no token; per-PR API at 60 req/h was infeasible), which does not return
   merge_commit_sha. mb_X = merge-base(head_X, upstream main tip at mining time). PRs whose head is an ancestor of main
   (fast-forward landed) are excluded with reason `head-in-main-ff` (162 of 1,547). Impact: selection only; recorded per PR.
2. **O1 stratum empty, O0 not built.** Under the frozen rules, Django 2024-2025 yielded 186 candidate pairs: O3 = 178,
   O2 = 8, **O1 = 0** (203 further pairs were excluded as `drift`: a patch does not apply alone to the shared base). Smoke drew
   O2 = 1, O3 = 2 (3 pairs, quota O1 unmet). Pilot drew O2 = 7, O3 = 10, then backfilled 13 from O3 (prereg §4.1 order).
   O0 controls are not part of the trial stage. Consequence: the same-hunk case that matters most for write safety is NOT
   exercised by real Django pairs in this trial; it is covered only by planted faults and earlier generations (E4/barrier).
3. **Selection hashes.** `SELECTION_RULES.sha256` was first written together with harness file hashes at 17:23; the oracle was
   then extended (alignment-free tiling, see 5) before any smoke/pilot run, so the sha file was rewritten to cover only the
   selection files (rules + mining/sampling scripts, all unchanged). Harness file hashes are in each generation's PINS.json.
4. **Arm definitions on general patches** (prereg §3.4 required harness changes): all arms relocate the writer's hunks onto the
   bytes current at submission (exact context, no fuzz), except git_three_way (merge-file against the PR base). file_lock uses
   a real cross-process lockfile (r1-r5 MP file_lock used an in-process mutex). occ and git_three_way keep the r1-r5
   check-then-write semantics (non-atomic across processes). See harness/hist-tools/README.md.
5. **Oracle.** oracle_v2-hist adds an alignment-free tiling judgement before the Myers description, after a dev run (not a trial
   run) showed Myers mis-attributing a code-move revert as frame damage. 19 contract/planted-fault tests pass (output included).
6. **Seed schedule** (prereg §3.5: "reuse E4 barrier"): the E4 barrier is not reused; seed fixes per-writer start offset
   (0-20 ms), per-file hold (0-30 ms) and file order, identical across arms. Wall-clock timing still varies under load, so two
   runs with the same seed are not byte-for-byte replays of the same interleaving.
7. **New files.** Files created by a PR are absent at base (`base_exists`, added after sampling; selection unchanged). PRs that add
   an empty file (no hunks) leave that file absent in every arm; the semantic endpoint then tests without it.
8. **Semantic endpoint.** STALE scoring with one union test patch (A then B) in every condition; F2P_X = tests passing on b+X+U
   that do not pass on b+U (includes tests whose module cannot even load at b, which Django reports as one `_FailedTest`).
   Python 3.13.5 venv (asgiref, sqlparse, tzdata) and `tests/runtests.py --parallel 1`; flaky = inconsistent across 3 solo reps.
9. **Concurrent load.** A separate r6 validation run used the same box CPU in parallel (load average up to ~8 on 8 cores).
   Concurrency was kept at 3 runs; no run timed out (worker timeout 180 s).
10. **ATM pin.** b35a6141 (main after PR #238), source tarball, ATM defaults (no ATM_STEWARD_* env overrides).

## Pilot-only
11. Pilot = 30 pairs x 5 arms x 2 seeds = 300 runs (prereg §7.2), no planted faults (they ran in smoke). Base validity holds for
    10 of 30 pairs; 2 pairs are not evaluable (union test patch conflict); the semantic table counts only base-valid pairs.
12. Prereg §7.2 acceptance item "manual spot check of 20 runs" was replaced by an automated, independent check over ALL runs:
    every run the oracle judged fully correct was compared byte-for-byte with git's own gold composition (`git apply` A then B):
    239/241 agree, 2 have no gold (A+B do not apply together), 0 disagree (`raw/crosscheck_gold.json`). Failing runs were
    inspected by hand (git_three_way lost updates, see GENERATION.md).
