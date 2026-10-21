---
doc_id: doc_TASK-PRF-0146
task_id: TASK-PRF-0146
title: 'Live-write commit path: repo-wide commit lock, own commitSha, atomic journal, honest message codes, crash reconciliation (#364)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0145
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0146.*
- .atm/history/task-events/TASK-PRF-0146/**
- .atm/history/tasks/TASK-PRF-0146.json
- .atm/task-plans/TASK-PRF-0146.md
- PROGRESS.md
- packages/core/src/live-write/**
- packages/core/src/broker/**
- packages/cli/src/commands/broker/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- scripts/validate-broker-steward.ts
- tests/core/**
- tests/cli/**
- tests/cli-fixtures/**
- research/paper-v2/prereg-v3-smoke/kit/bin/**
- research/paper-v2/prereg-v3-smoke/kit/test/**
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
validators:
- node --strip-types tests/core/live-write-commit-path.test.ts
- node --strip-types tests/core/live-queued-write.test.ts
- node --strip-types tests/core/cross-session-overlap.test.ts
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types scripts/validate-broker-steward.ts
deliverables:
- packages/core/src/live-write/live-queued-write.ts
- tests/core/live-write-commit-path.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- Do not re-pin the hist-v2 smoke runbook or modify sealed archives. Do not tag or publish npm.
completed_at: "2026-10-21T03:14:18.723Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T03:14:18.723Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T03-14-18-723Z-close-d3d315c4a2fc"
lastTransitionAt: "2026-10-21T03:14:18.723Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "678ad2728"
---

# TASK-PRF-0146 — live-write commit path (#364)

## Authority and scope

User-approved on 2026-10-21 09:13 (Asia/Taipei). Issue: [#364](https://github.com/eaglhuang/AI-Atomic-Framework/issues/364). Code and tests are written by the box Codex CLI; Grok Bot only orchestrates.

## Design

- D1: a repo-wide commit lock (taken after the per-file lock) serializes git index operations; bounded retry exhaustion maps to `git-index-contention`, never kit-error.
- D2: commitSha is the commit this write created (verified by its subject/proposal id), never a later HEAD read.
- D3: journal lines are appended in one write; a torn last line is ignored, any other bad line is `recovery-required`; the kit reader follows the same rule.
- D4: message codes QUEUED / REJECTED / KIT_ERROR; missing target is `target-missing`, queued false.
- AC5: intent/committed journal records; a dangling intent is reconciled on the next lock acquisition.

## Acceptance

- #364 AC1-AC6, including the 8x15 multi-process stress (0 kit-errors, 100% matching commitSha), torn-journal and kill-between-rename-and-commit fixtures, and per-reasonCode label assertions.