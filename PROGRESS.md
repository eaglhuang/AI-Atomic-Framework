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
