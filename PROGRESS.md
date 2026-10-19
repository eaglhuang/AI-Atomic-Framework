# PROGRESS — fix/359-unified-patch-offset-locator (#359, #361)

Append-only log. Times are Asia/Taipei (UTC+8).

- 2026-10-19 22:54 Restart from scratch after the ~22:00 box move lost /workspace/fix359 (branch was never pushed). Fresh clone of main @ fe2cd7ef into /workspace/AI-Atomic-Framework-359/AI-Atomic-Framework; branch created; npm ci done (Node 24.10).
- 2026-10-19 23:04 ATM task TASK-PRF-0135 imported and claimed (actor grok-bot, lane lane-20261019145650-grok-bot-809bede168).
- 2026-10-19 23:04 Codex run 1 done (core parser/locator, composer, region-rebase, live-write, tests). Usage: 1,013,443 input (949,888 cached), 14,741 output. Review fixes by hand: restored eofNewlineDecision pure-insertion semantics; composer error detail keeps proposal id. Focused tests pass. v10c fixtures extracted to tests/fixtures/unified-patch-v10c (archive untouched).
