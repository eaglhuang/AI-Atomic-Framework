---
doc_id: doc_TASK-PRF-0155
task_id: TASK-PRF-0155
title: 'Merge main into #364 branch and regenerate release manifests (PR #381)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0154
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0155.*
- .atm/history/task-events/TASK-PRF-0155/**
- .atm/history/tasks/TASK-PRF-0155.json
- .atm/task-plans/TASK-PRF-0155.md
- release/atm-onefile/**
- release/atm-root-drop/**
- packages/cli/dist/**
validators:
- node atm.mjs --help
deliverables:
- release/atm-onefile/release-manifest.json
- release/atm-root-drop/release-manifest.json
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- Do not re-pin the smoke runbook. Do not tag or publish npm.
completed_at: "2026-10-21T05:02:27.703Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T05:02:27.703Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T05-02-27-703Z-close-da585f1f76cc"
lastTransitionAt: "2026-10-21T05:02:27.703Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "9e3bce4e8b7f7210d0a008364c1921066f073dd6"
---

# TASK-PRF-0155 — merge main into PR #381 branch

PR #381 conflicts with main only in the two release manifests after PR #380 merged. Merge origin/main, regenerate manifests through a sealed build with runner-sync receipt.
