# Friction from TASK-PRF-0160 (dist rebuild), 2026-10-30 Asia/Taipei
1. `taskflow close --write` stages only the declared deliverables plus the onefile runner outputs. It ignores the scope globs `packages/cli/dist/**` and `release/atm-root-drop/**`, even though the runner-sync receipt marks them owned-current.
   - Commit 63d3b1572b has only `release/atm-onefile/*`. 43 dist files and about 150 root-drop files stayed dirty.
   - The closure packet's governedTreeSha ba930b11 includes dist; the commit tree 250ab743 does not. They differ by 173 files.
   - allowedRunnerOutputFiles has 2 entries; PRF-0159 had 460.
2. The `.gitignore` rule `dist/` hides 11 new runtime modules that the rebuilt dist imports, so they need `git add -f`.
   - Examples: `taskflow/close-attempt.js`, `close-candidate.js`, `close-claim-renewal.js`, `close-detach.js`, `generated-output-advisory.js`, `next/quickfix-scope-policy.js`, `tasks/renew-framework-temp.js`, `upgrade/base-sync.js`, `candidate-file-policy.js`, `broker/generated-output-digests.js`, `steward-json-pointer-compose.js`.
3. The sealed build needs at least 7200 s left on the claim, and a fresh claim has less. Run `tasks renew --ttl-seconds 14400` first.
4. The framework repo has no taskflow profile, so `taskflow open --write` fails closed. Only `tasks new` followed by `tasks import` works.
5. `commit-bundle-assembly.spec.ts` fails whenever `ATM_LANE_SESSION_ID` is set in the environment. Through pre-team-foundation-gate this turns `validate:quick` red inside any lane, so the test is not isolated from the env.
6. Generated `.d.ts` files depend on the tsc `.types` and incremental cache, so `map-hash.d.ts` and `bootstrap-support.d.ts` come out differently in a sealed build and a clean build.

# Friction from the close-stage quickfix and TASK-PRF-0161, 2026-10-30 Asia/Taipei
7. Root cause of item 1: the inventory classifies paths with `git check-ignore --no-index`, which also matches tracked files under `dist/`. Tracked dist and root-drop outputs were marked `generated`, dropped by the close handoff, and filtered or rejected by the candidate policy.
   - Fixed by quickfix 43a9586060: tracked paths are always candidates. Untracked ignored outputs still need an exact declaration, which keeps the PRF-0156 rule that generated is not delivery.
8. `next --claim --prompt --files` would not open a quickfix while stale active tasks (ATM-GOV-0288, TASK-PRF-0040) exist: ATM_NEXT_CLAIM_NO_TASK, then ACTIVE_TASK_DIVERGENCE_BLOCKED.
   - `quickfix claim --actor --files --prompt --reason` works.
9. Pre-existing ignored outputs whose bytes do not change are missing from the runner inventory, because the snapshot diff catches only changed bytes. New runtime modules from earlier local builds are therefore never receipt-owned.
10. A card imported with `status: planned` cannot be claimed: ATM_TASK_CLAIM_NOT_READY.
    - Re-importing after editing it to `ready` is refused (ATM_TASKS_IMPORT_WRITE_FAILED, conflicts). The only fix was to delete the untracked card JSON and import event and import again.
11. `release/*` is also gitignored. Root-drop has about 54 untracked non-.d.ts mirrors of new sources, tests, and docs that no close will pick up unless they are declared one by one.
12. `tasks claim` without `--files` binds the runtime scope to the card JSON only. Close then fails closed with "Scope amendment required" on every rebuilt dist file.
    - Fix: run `tasks scope add --add <card scopePaths>`, or claim with `--files` the way PRF-0160 did.
13. `taskflow close --write` needs `ATM_LANE_SESSION_ID` (the lane minted at claim). Without it you get ATM_LANE_BORROWED_ACTOR_BLOCKED.
    - Unset it only for the commit-bundle-assembly spec and validate:quick.
