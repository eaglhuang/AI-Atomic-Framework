---
doc_id: doc_TASK-PRF-0156
task_id: TASK-PRF-0156
title: 'P2: never force-add ignored/generated files in close bundles'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0153
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0156.*
- .atm/history/task-events/TASK-PRF-0156/**
- .atm/history/tasks/TASK-PRF-0156.json
- .atm/task-plans/TASK-PRF-0156.md
- packages/cli/src/commands/git-governance/**
- packages/cli/src/commands/taskflow/**
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- tests/**
- docs/governance/**
validators:
- npm run typecheck
deliverables:
- packages/cli/src/commands/git-governance/implementation/sealed-commit-candidate-index.ts
- docs/governance/proposals/review-r1-xiaodou-2026-10-21.md
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- No history cleanup of already-tracked ignored files. No tag or npm publish.
completed_at: "2026-10-21T14:36:30.579Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T14:36:30.579Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T14-36-30-579Z-close-924610417167"
lastTransitionAt: "2026-10-21T14:36:30.579Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "41eefe252"
---

# TASK-PRF-0156 — P2 exact per-file staging

Implements P2 from docs/governance/proposals/governance-token-cost-proposals-2026-10.md as amended by review r1 (docs/governance/proposals/review-r1-xiaodou-2026-10-21.md). Code by the box Codex CLI. Also adds friction rows F27-F32.