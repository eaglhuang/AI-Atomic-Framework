---
doc_id: doc_TASK-PRF-0144
task_id: TASK-PRF-0144
title: 'Original-intent anchoring and cross-session-overlap rejection for live steward writes (#360)'
status: open
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0143
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0144.*
- .atm/history/task-events/TASK-PRF-0144/**
- .atm/history/tasks/TASK-PRF-0144.json
- .atm/task-plans/TASK-PRF-0144.md
- PROGRESS.md
- packages/core/src/broker/**
- packages/core/src/live-write/**
- packages/cli/src/commands/broker/**
- packages/cli/src/commands/command-specs/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- scripts/**
- tests/cli/**
- tests/core/**
- research/paper-v2/prereg-v3-smoke/kit/**
validators:
- node --strip-types tests/core/cross-session-overlap.test.ts
- node --strip-types tests/core/live-queued-write.test.ts
- node --strip-types tests/core/stale-base-translation.test.ts
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types scripts/validate-broker-steward.ts
deliverables:
- packages/core/src/live-write/cross-session-overlap.ts
- packages/core/src/live-write/live-queued-write.ts
- packages/cli/src/commands/broker/steward-runtime-actions.ts
- tests/core/cross-session-overlap.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; live writes go back to accepting any fresh-base write.
nonGoals:
- Do not re-pin the hist-v2 smoke runbook or modify any sealed archive; v10c's sealed result stands.
- Do not tag or publish npm.
- The merge-plan steward path (`broker steward apply`) keeps #363 stale-base translation; anchoring is live-write only (documented).
---

# TASK-PRF-0144 — original-intent anchoring, cross-session-overlap (#360)

## Authority and scope

User-approved on 2026-10-21 07:09 (Asia/Taipei). Issue: [#360](https://github.com/eaglhuang/AI-Atomic-Framework/issues/360). Builds on #363 (`stale-base-translation.ts`).

## Design

- Each live-write journal entry also records the actor, commit sha and the committed change blocks in before and after coordinates (with removed and added lines).
- The first write proposal an actor submits for a file anchors that actor's original base for the file (`.atm/runtime/live-write-anchors.jsonl`).
- Every write, fresh-base or stale, computes the lines it deletes or modifies in current coordinates and intersects them with the lines other actors committed since the anchor, mapped forward to the current file. An intersection rejects with `cross-session-overlap`, names the other actor, proposal and commit, shows their diff and the current ranges, and asks to merge both intents or abandon. The file is not touched.
- A context mismatch whose cause is another actor's change since the anchor is classified as `cross-session-overlap`.
- `--ack-overlap <proposalId>` lets an explicit override through only when it names every overlapping proposal; the acknowledgement is recorded in the journal and the write record.
- Same-actor and disjoint edits are never flagged.

## Acceptance

- #360 AC8 cases in tests/core/cross-session-overlap.test.ts, including the v10c replay and stubbed multi-session concurrency.
- Existing live-write, stale-base and broker-steward suites still pass; 600-line budget holds.
