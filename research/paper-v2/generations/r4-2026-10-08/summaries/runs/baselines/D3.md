# D3 — Git three-way baseline (`git_three_way`)

**Status:** done (2026-10-07 21:32 CST)  
**Harness:** `/workspace/reports/atm-v2-harness`  
**ATM pin:** `5692474f7db70ab52a7a71c8af4867609e7e4b43` (no ATM source edits)

## Story

D3 compares **existing git merge capability** to ATM composer+steward. Concurrent same-file edits are collected in a harness compose window, then folded with system `git merge-file`. Conflict markers / nonzero status → **blocked** with receipt; canonical worktree is **not** overwritten.

## How n-way fold works (disclosure)

`git merge-file` is **pairwise only**. This arm does **not** claim true multi-parent n-way merge.

**Algorithm (`pairwise_left_fold_shared_base`):**

1. On batch open, snapshot shared **base** blob (worktree bytes).
2. Each agent builds an independent **theirs** = `insertIntoRegion(base, region, marker)` (against the shared base, not the accumulator).
3. Left-fold:
   - `acc₀ = base`
   - `accₖ₊₁ = git merge-file(ours=accₖ, orig=base, theirs=patchₖ₊₁)`
4. If any step conflicts (`status > 0` or `<<<<<<<` in output) → whole batch **blocked**; write `conflict.txt` + `fold_receipt.json` under `artifacts/git_merge/<batch_id>/`; leave worktree at base.
5. If live worktree drifted from batch base before apply → `git_base_drift` blocked (no silent clobber).

Order = submit order inside the window. **Late joiner after close → new batch** (same C2 rule).

Window close for this arm: `compose_window_ms` timeout (expectedCount = ∞ via `git_timeout_only`), or immediate when `compose_window_ms=0`.

## Arm mapping

| CLI `--arm` | aliases | `atm_writer` | `arm_role` | `diagnostic` | `correctness_competitor` |
|-------------|---------|--------------|------------|--------------|--------------------------|
| `git_three_way` | `git_merge`, `three_way` | `git_three_way` | `baseline_git` | `false` | `true` |

Worktree is git-init'd via `initWorktreeGit` (shared with steward).

## Same-hunk conflict (unit)

Two inserts into the same region against one base → `git_merge_conflict`, both agents `blocked`, worktree unchanged. Differs from steward, which can compose intentional marker inserts.

## Smoke compare (seed 11, agents 3, trials 5, hot=1, overlap=high, hold 8–25 ms, real ATM)

| arm | correct | lost | committed | blocked | max batch | conflict batches | mean overhead_ms | wall_ms |
|-----|---------|------|-----------|---------|-----------|------------------|------------------|---------|
| **git_three_way** | 15 | 0 | 15 | 0 | 3 | 0 | 111.78 | 718.46 |
| steward | 15 | 0 | 15 | 0 | 2 | 0 | 60.56 | 573.91 |
| occ | 15 | 0 | 15 | 0 | — | — | 13.32 | 178.92 |
| file_lock | 15 | 0 | 15 | 0 | — | — | 20.52 | 218.48 |

On this workload concurrent peers mostly hit **different regions** on the same file, so the fold succeeds (classic non-overlapping three-way). Overhead is higher than steward here (process spawn + temp files per merge step). Same-region conflict behavior is covered by the unit above / `fold_receipt` artifacts.

Runs: `runs/d3-git_three_way`, `d3-steward`, `d3-occ`, `d3-file_lock`.  
Raw: `runs/steward-writer/d3_compare_raw.json`.

### Reproduce

```bash
export ATM_MONOREPO=/path/to/AI-Atomic-Framework-5692474f…
COMMON='--seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --jitter-ms 6 --tick-interval-ms 15 --compose-window-ms 80 --atm-backend real --force'
node src/cli.mjs start --arm git_three_way --run-id d3-git_three_way $COMMON
node src/cli.mjs start --arm steward --run-id d3-steward $COMMON
node src/cli.mjs start --arm occ --run-id d3-occ $COMMON --occ-max-retries 8
node src/cli.mjs start --arm file_lock --run-id d3-file_lock $COMMON
```

## Files changed

- `src/git-three-way.mjs` — `gitMergeFile`, `foldMergeFile`, `GitThreeWayManager`
- `src/arms.mjs` — `git_three_way` / `baseline_git` + aliases
- `src/runner.mjs` — writer path, git init, batch sink, timeout collect
- `src/cli.mjs`, `src/scenario.mjs` — CLI / param comment
- Docs: this file + `runs/baselines/D3.md`

## Gaps → D4 (bare composer)

- No ATM `composeBrokerProposals` without broker admission yet (D4: bare composer + guarded apply, broker admit off).
- Fold order sensitivity / true n-way not explored beyond disclosure.
- Multi-process shared merge window not done.
- `logical_id` still stubbed to `intent_id`.

**Next default: D4** bare composer.
