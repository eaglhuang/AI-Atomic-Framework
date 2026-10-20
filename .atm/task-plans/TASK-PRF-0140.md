---
doc_id: doc_TASK-PRF-0140
task_id: TASK-PRF-0140
title: 'Stale-base writes placed by base-to-current translation, never at stale line numbers (#363)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0139
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0140.*
- .atm/history/task-events/TASK-PRF-0140/**
- .atm/history/tasks/TASK-PRF-0140.json
- .atm/task-plans/TASK-PRF-0140.md
- PROGRESS.md
- packages/core/src/broker/**
- packages/core/src/live-write/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- scripts/**
- tests/cli/**
- tests/core/**
- research/paper-v2/prereg-v3-smoke/kit/**
validators:
- node --strip-types tests/core/stale-base-translation.test.ts
- node --strip-types tests/core/live-queued-write.test.ts
- node --strip-types tests/cli/unified-patch-eof-newline.test.ts
- node --strip-types tests/cli/unified-patch-eol.test.ts
- node --strip-types tests/cli/unified-patch-locator.test.ts
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-hunk-locator-parity.sh
deliverables:
- packages/core/src/broker/stale-base-translation.ts
- packages/core/src/live-write/live-queued-write.ts
- packages/core/src/broker/steward-transactional-apply.ts
- tests/core/stale-base-translation.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; restores declared-line re-application for stale writes.
nonGoals:
- Do not re-pin the hist-v2 smoke runbook or modify any sealed archive.
- Original-intent anchoring and cross-session-overlap rejection stay in #360.
- Do not tag or publish npm.
completed_at: "2026-10-20T16:59:39.191Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-20T16:59:39.191Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-20T16-59-39-191Z-close-70d33d7a974e"
lastTransitionAt: "2026-10-20T16:59:39.191Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "4408ea4c7"
---

# TASK-PRF-0140 — stale-base translation (#363)

## Authority and scope

User-approved next item of the write-path hardening order (umbrella #367) on 2026-10-20. Issue: [#363](https://github.com/eaglhuang/AI-Atomic-Framework/issues/363). Also folds in #374 items 1-3 (EOF-marker edge cases in the same files).

## Design

- A stale-base hunk is located in the declared base text (the version it was authored on), its change blocks are derived from the patch, and the base-to-current changes are diffed. Blocks are merged three-way with `git merge-file` conflict semantics (overlapping or touching changes conflict) and mapped forward to current coordinates.
- A line the stale patch deletes or modifies that has changed since the base is a conflict: rejected, never applied elsewhere. A base whose text is unavailable is `stale-base`.
- Live write (C1), steward re-compose inside the apply queue (C3) and the kit wrapper base inference (C2) all use declared-base translation; no stale write is re-read at declared line numbers.
- The translation exposes the forward line map and translated ranges so #360 can map other actors' committed ranges to current coordinates.

## Acceptance

- #363 AC1-AC5: the 3-line repro ends with B3 on the second `b` or rejected, for C1/C2/C3; repetitive-context fixtures; unique translated placement applies, conflicting ones reject.
- Differential test against `git merge-file`: our placement is byte-identical to git whenever both merge cleanly, and every git conflict is rejected.