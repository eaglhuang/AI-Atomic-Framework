# PROGRESS — fix/359-unified-patch-offset-locator (#359, #361)

Append-only log. Times are Asia/Taipei (UTC+8).

- 2026-10-19 22:54 Restart from scratch after the ~22:00 box move lost /workspace/fix359 (branch was never pushed). Fresh clone of main @ fe2cd7ef into /workspace/AI-Atomic-Framework-359/AI-Atomic-Framework; branch created; npm ci done (Node 24.10).
- 2026-10-19 23:04 ATM task TASK-PRF-0135 imported and claimed (actor grok-bot, lane lane-20261019145650-grok-bot-809bede168).
- 2026-10-19 23:04 Codex run 1 done (core parser/locator, composer, region-rebase, live-write, tests). Usage: 1,013,443 input (949,888 cached), 14,741 output. Review fixes by hand: restored eofNewlineDecision pure-insertion semantics; composer error detail keeps proposal id. Focused tests pass. v10c fixtures extracted to tests/fixtures/unified-patch-v10c (archive untouched).
- 2026-10-19 23:08 Kit: generated copy bin/unified-patch.generated.mjs (+ bin/generate-unified-patch.mjs, --check), atm-write.mjs now imports it (own parser deleted), malformed patches -> rejected-by-design/patch-malformed exit 3 without calling the CLI, chooseDeclaredBase uses located lines, records carry hunkOffsets. New kit tests test-hunk-locator-parity.sh (439 cases, Node 22 + 24) and test-atm-write-malformed.sh, both wired into preflight.sh. Core: tests/cli/unified-patch-v10c-replay.test.ts, stale-overlap-with-offset case in tests/core/live-queued-write.test.ts, both new suites wired into validate-broker-steward. typecheck + eslint clean; focused suites pass.
- 2026-10-19 23:11 Sealed runner build (ATM_ACTOR_ID=grok-bot ATM_RUNNER_PUBLICATION_TASK=TASK-PRF-0135, from 6a6d00b0d): packages/cli dist, onefile and root-drop rebuilt; runner-sync receipt .atm/history/evidence/TASK-PRF-0135.runner-sync-receipt.json (published). First offline preflight failed at false-accept: its fixture used a malformed patch that now never reaches the CLI; switched it to a well-formed context-only no-op hunk (guard intent unchanged). Re-running preflight.

## 2026-10-19 23:25 Asia/Taipei — ATM close done
- Scope amendment: added bare `packages/cli/dist` (deliverable was outside lock; only `packages/cli/dist/**` was listed).
- `taskflow close --historical-delivery 2096a8664 --write` → deliver f31d938a9 + close f5cb2aaea (ATM_TASKFLOW_CLOSE_WRITE_ORCHESTRATED).
- Deliver bundle re-adds ~470 vendored .d.ts files present in the runner-sync receipt inventory (same churn as TASK-PRF-0130 add / TASK-PRF-0132 delete) and root-drop mirrors of the new tests/fixtures.
- Next: clean sweep in detached worktree, PR, CI.

## 2026-10-19 23:40 Asia/Taipei — sweep + PR
- Clean sweep in detached worktree sweep-e787598db3: PASS (npm ci, typecheck, 6 test files, broker-cowrite, broker-steward, kit parity, offline kit preflight all ok, git clean).
- PR #370 opened (Closes #359, #361). Waiting for CI on e787598db.

## 2026-10-20 00:31 Asia/Taipei — CI on e787598db: Product CI + ATM Dogfood failed
Both jobs failed on the same two validators:
1. `validate-hist-v2-harness`: fixture `rename`, arm `atm` → "rename left the source path in place". Root cause: the harness submits an empty patch for a rename, and the shared compose inbox relied on the old `applyUnifiedPatch` returning the base when there were no hunks. The strict parser now refuses it, so the member failed and the rename never happened. Fix (follow-up task TASK-PRF-0136): `materializeMember` treats a whitespace-only patch as identity. The parser stays strict, and prose without hunks still fails. New case added to shared-compose-inbox.test.ts.
2. `validate-hist-v2-smoke-runbook`: PIN_MISMATCH, because `packages/core/src/broker` now differs from the pinned core merge cb2524243. The sealed runbook checks the live checkout, and this is the first PR since the pin to touch the broker. Fix: the (unsealed) validator runs the runbook tests in a throwaway detached worktree of HEAD with the pinned core paths restored to cb2524243. No sealed bytes changed.
Both validators pass locally. ATM: TASK-PRF-0136 imported and claimed (lane lane-20261019162919-grok-bot-66c3111f2d); the scope was amended to add scripts/validate-hist-v2-smoke-runbook.ts.

## 2026-10-20 00:36 Asia/Taipei — TASK-PRF-0136 closed
- Full rebuild c6d375a50 (receipt sealed at 11cedf46b). Evidence for both validators recorded. `taskflow close --historical-delivery c6d375a50 --write` → close commit 68dd06d88.
- The full rebuild drops the ~469 stale vendored .d.ts files that the earlier incremental build had re-added, so dist again matches main for those files.

## 2026-10-20 00:55 Asia/Taipei — CI on 52b5a811d
- ATM Dogfood: success. All 5 other jobs: success. Product CI failed, but only on `worktree-callsite-census.test.ts`: the new `git worktree add` in validate-hist-v2-smoke-runbook.ts is an unclassified production worktree call site, and the production classes are a closed set.
- Fix (follow-up task TASK-PRF-0137, lane lane-20261019165542-grok-bot-b6f2c9fc27): the validator uses a throwaway `git clone --shared --no-checkout` instead of a linked worktree. Runbook validator (26 tests) and census test pass locally.
- 2026-10-20 00:58 Asia/Taipei: TASK-PRF-0137 closed (taskflow close --historical-delivery 7a0280fec --write → 9e2ed1e58). No runner-sync receipt was needed because only a script changed. Waiting for CI.

## 2026-10-20 01:17 Asia/Taipei — CI on 758d1c146: ATM Dogfood failed
- `validate-hist-v2-smoke-runbook` failed with "unable to read sha1 file" for blobs of the pinned merge. CI checks out with `filter: blob:none`, and the `--shared` clone cannot fetch missing blobs lazily. Reproduced locally in a blob:none clone. The harness validator and the census pass in CI.
- Fix (follow-up task TASK-PRF-0138, lane lane-20261019171738-grok-bot-69c0e384a1): before cloning, the validator runs a binary content diff of the pinned paths in this repository, which batch-fetches both sides. Verified in a blob:none clone (26 tests OK) and in a full checkout.

## 2026-10-20 01:25 Asia/Taipei — TASK-PRF-0138 close recovery
- The `taskflow close --write` run was interrupted after phase `ledger-written`: the ledger said done, the bundle was partly staged, no commit was made, and the owner pid was gone. A rerun was blocked by `ATM_PLANNING_SOURCE_IDENTITY_DRIFT`, because close had already appended its metadata to the md. With the sealed md restored, the planner instead offered a planning-mirror re-import, which would have conflicted with the done ledger. I took neither path, so there was no double close.
- Finished the commit step through ATM's own surfaces. `atm git commit --task TASK-PRF-0138` created 6eeb4ce70 with the 9 ledger, event, bundle and closure files, carrying the sealed receipt's ATM-Seal-Digest/Manifest/Target-Head-Before trailers and an ATM-Close-Recovery trailer. `atm git record-commit` created 9a6f1699e for the seal-and-commit receipt.
- .atm/task-plans/TASK-PRF-0138.md (the closed mirror) is left untracked: the governed commit surfaces refuse it after close, and I did not commit it with raw git.

# #362: per-line EOL preservation (branch fix/362-eol-preserving-patch)

## 2026-10-20 06:50 Asia/Taipei — start
- Base: main 119158900 (PR #370 merged). Codex is logged in on the box and GH_ATM_PUSH_TOKEN is set.
- ATM: TASK-PRF-0139 imported and claimed (grok-bot, lane lane-20261019224956-grok-bot-70b5fb0cd6). Its scope includes the leftover closed card .atm/task-plans/TASK-PRF-0138.md.
