---
doc_id: doc_TASK-PRF-0156
task_id: TASK-PRF-0156
title: 'Preserve steward JSON composition bytes and reject nested pointers (#365)'
status: ready
owner: grok-bot
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0156.*
- .atm/history/task-events/TASK-PRF-0156/**
- .atm/history/tasks/TASK-PRF-0156.json
- .atm/task-plans/TASK-PRF-0156.md
- packages/core/src/broker/steward-transactional-apply.ts
- packages/core/src/broker/steward-json-pointer-compose.ts
- tests/core/steward-json-pointer-compose.test.ts
- PROGRESS.md
- packages/core/dist
- packages/core/dist/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- npm run typecheck
- npx eslint packages/core/src/broker/steward-transactional-apply.ts packages/core/src/broker/steward-json-pointer-compose.ts tests/core/steward-json-pointer-compose.test.ts
- node --experimental-strip-types tests/core/steward-json-pointer-compose.test.ts
- node --experimental-strip-types tests/core/transactional-steward-single-write.test.ts
- npm run preclose:check
deliverables:
- packages/core/src/broker/steward-json-pointer-compose.ts
- packages/core/src/broker/steward-transactional-apply.ts
- tests/core/steward-json-pointer-compose.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- Do not re-pin the smoke runbook. Do not tag or publish npm.
---

# TASK-PRF-0156 — issue #365

## Acceptance
- Decoded JSON pointers must be prefix-disjoint; conflicting and nonconflicting nested proposals use the strict text route and block on overlap.
- Sibling proposals compose by disjoint original-byte splices with selected attribution; untouched odd spacing and CRLF round-trip.
- Cover escaped tokens, ambiguous splice fallback, order independence and independent actor proposals sharing one base.

Opening decision: consumed issue #365 (no comments), immutable-base composer and prior task/build governance receipts. No external data is needed. This touches the existing steward shared-write composition decision, without adding a gate. Stop and fall back to the strict text composer whenever safe disjoint text splices cannot be proven.
