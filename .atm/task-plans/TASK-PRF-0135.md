---
doc_id: doc_TASK-PRF-0135
task_id: TASK-PRF-0135
title: 'Unified-patch strict parser and offset locator (#359, #361)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0134
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0135.*
- .atm/history/task-events/TASK-PRF-0135/**
- .atm/history/tasks/TASK-PRF-0135.json
- .atm/task-plans/TASK-PRF-0135.md
- PROGRESS.md
- packages/core/src/broker/**
- packages/core/src/live-write/**
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- scripts/**
- tests/cli/**
- tests/core/**
- tests/fixtures/unified-patch-v10c/**
- research/paper-v2/prereg-v3-smoke/kit/**
validators:
- node --strip-types tests/cli/unified-patch-locator.test.ts
- node --strip-types tests/cli/unified-patch-v10c-replay.test.ts
- node --strip-types tests/cli/unified-patch-application.test.ts
- node --strip-types tests/cli/unified-patch-eof-newline.test.ts
- node --strip-types tests/core/live-queued-write.test.ts
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-hunk-locator-parity.sh
deliverables:
- packages/core/src/broker/unified-patch.ts
- packages/core/src/broker/steward-base-composer.ts
- packages/core/src/live-write/live-queued-write.ts
- tests/cli/unified-patch-locator.test.ts
- tests/cli/unified-patch-v10c-replay.test.ts
- research/paper-v2/prereg-v3-smoke/kit/bin/atm-write.mjs
- research/paper-v2/prereg-v3-smoke/kit/bin/unified-patch.generated.mjs
- research/paper-v2/prereg-v3-smoke/kit/test/test-hunk-locator-parity.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-atm-write-malformed.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; restores the strict-at-oldStart applier and the kit's own parser.
nonGoals:
- Do not modify any sealed archive (v1-v10c); v10c's result stands as recorded.
- Do not tag, publish npm, or run real-model #311 experiments.
- No fuzz matching or whitespace normalisation; ambiguity refuses.
completed_at: "2026-10-19T15:24:20.217Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T15:24:20.217Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T15-24-20-217Z-close-8efc65315df1"
lastTransitionAt: "2026-10-19T15:24:20.217Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "2096a8664"
---

# TASK-PRF-0135 — strict unified-patch parser and exact-context offset locator

## Authority and scope

User-approved redo of the #359 / #361 fix on 2026-10-19 (the first attempt was lost in a box move before it was pushed). Related: [#359](https://github.com/eaglhuang/AI-Atomic-Framework/issues/359), [#361](https://github.com/eaglhuang/AI-Atomic-Framework/issues/361), umbrella [#367](https://github.com/eaglhuang/AI-Atomic-Framework/issues/367), evidence [#358](https://github.com/eaglhuang/AI-Atomic-Framework/pull/358).

## Design

- One strict parser (`parseUnifiedPatch`): fail closed on zero hunks, an unprefixed body line, header-count mismatch (policy: reject), multi-file patches or a file other than the target. `git -U0` semantics: old count 0 inserts after line `oldStart`.
- One locator (`locateUnifiedPatchHunks`): exact old-side match (zero fuzz) at the declared start, then outward within `HUNK_LOCATOR_WINDOW` = 50 lines, then a whole-file fallback that must be unique. Ties refuse as ambiguous. Stale writes (declared base is not the current file) require a unique match file-wide.
- Base-aware live write: overlap against the journal is computed at positions located in the declared base text; journal lines are recorded at the located positions in the text actually patched. Results carry `hunkOffsets`.
- The prereg kit wrapper uses a generated copy of the core module (`kit/bin/unified-patch.generated.mjs`), guarded by the `hunk-locator-parity` preflight check. Malformed patches become `rejected-by-design` / `patch-malformed` records instead of crashes.

## Acceptance

- #359 AC1-AC8 and #361 AC1-AC6 covered by the validators above; v10c rec 0/2/6 apply at offsets +1/+2/-1, rec 1/4 still reject.
- Offline kit preflight passes, including `hunk-locator-parity`.
- `packages/cli` dist, onefile and root-drop rebuilt through the normal pipeline.
