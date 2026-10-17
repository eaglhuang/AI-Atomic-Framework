# STATUS: INVALID (executor judgment) — do not cite
Run 20261017T004036Z-3207762-31030, main 63249e428 (#339 merged), unix-user, gpt-6-luna, medium. Kit status=blocked. Added after seal; not in SHA256SUMS.
Snapshot checks passed: Arm A snapshot 8189188ef (parent = base 98ad3278) is non-empty (2 files, +14/-1), the worktree has no diff/untracked vs the snapshot, and final.diff sha256 == git diff base..snapshot (89fb04ee…). Arm B snapshot 107d5ee76 == steward HEAD (only kit dirs .atm/ .prereg-smoke/ untracked); final.diff sha256 matches (98ebe7aa…).
Reasons for INVALID:
1. Arm A git commits failed for a sandbox reason, not concurrency: both Arm A sessions report "`.git/index.lock` is on a read-only filesystem" (codex workspace-write keeps .git read-only). Arm A's commit path is therefore broken by the harness, which distorts Arm A's conflict/lost-edit behaviour.
2. indexLockCount is null for Arm A although both sessions' stdout reports index.lock failures (1 and 2 mentions); the counter only matches specific command-event shapes, so the evidence is mis-recorded.
3. Sessions report they could not run tests ("Python environment lacks distutils"), so the in-session environment differs from the evaluator venv.
