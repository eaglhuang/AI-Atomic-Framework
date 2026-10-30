---
doc_id: doc_TASK-PRF-0161
task_id: TASK-PRF-0161
title: "Rebuild packages/cli/dist and root-drop and commit every runtime output"
status: done
owner: grok-bot
priority: P1
milestone: RFT-M
depends_on:
[]
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - ".atm/history/evidence/TASK-PRF-0161.*"
  - ".atm/history/task-events/TASK-PRF-0161/**"
  - ".atm/history/tasks/TASK-PRF-0161.json"
  - ".atm/task-plans/TASK-PRF-0161.md"
  - "PROGRESS.md"
  - "packages/cli/dist"
  - "packages/cli/dist/**"
  - "release/atm-onefile/**"
  - "release/atm-root-drop/**"
validators:
  - "npm run validate:quick"
deliverables:
  - "packages/cli/dist/atm.js"
  - "release/atm-onefile/atm.mjs"
  - "release/atm-onefile/release-manifest.json"
  - "release/atm-root-drop/release-manifest.json"
  - "packages/cli/dist/_vendor/core/dist/broker/generated-output-digests.js"
  - "packages/cli/dist/_vendor/core/dist/broker/steward-json-pointer-compose.js"
  - "packages/cli/dist/commands/git-governance/implementation/candidate-file-policy.js"
  - "packages/cli/dist/commands/next/quickfix-scope-policy.js"
  - "packages/cli/dist/commands/taskflow/close-attempt.js"
  - "packages/cli/dist/commands/taskflow/close-candidate.js"
  - "packages/cli/dist/commands/taskflow/close-claim-renewal.js"
  - "packages/cli/dist/commands/taskflow/close-detach.js"
  - "packages/cli/dist/commands/taskflow/generated-output-advisory.js"
  - "packages/cli/dist/commands/tasks/renew-framework-temp.js"
  - "packages/cli/dist/commands/upgrade/base-sync.js"
  - "release/atm-root-drop/packages/cli/dist/_vendor/core/dist/broker/generated-output-digests.js"
  - "release/atm-root-drop/packages/cli/dist/_vendor/core/dist/broker/steward-json-pointer-compose.js"
  - "release/atm-root-drop/packages/cli/dist/commands/git-governance/implementation/candidate-file-policy.js"
  - "release/atm-root-drop/packages/cli/dist/commands/next/quickfix-scope-policy.js"
  - "release/atm-root-drop/packages/cli/dist/commands/taskflow/close-attempt.js"
  - "release/atm-root-drop/packages/cli/dist/commands/taskflow/close-candidate.js"
  - "release/atm-root-drop/packages/cli/dist/commands/taskflow/close-claim-renewal.js"
  - "release/atm-root-drop/packages/cli/dist/commands/taskflow/close-detach.js"
  - "release/atm-root-drop/packages/cli/dist/commands/taskflow/generated-output-advisory.js"
  - "release/atm-root-drop/packages/cli/dist/commands/tasks/renew-framework-temp.js"
  - "release/atm-root-drop/packages/cli/dist/commands/upgrade/base-sync.js"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit to restore the previous committed dist and release runner."
atomizationImpact:
  ownerAtomOrMap: "atm.unowned"
  mapUpdates: []
outOfScope:
  - "packages/*/src/**"
nonGoals:
  - "No source behavior changes; generated outputs only."
completed_at: "2026-10-30T03:50:45.476Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-30T03:50:45.476Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-30T03-50-45-476Z-close-0e8b74a894cd"
lastTransitionAt: "2026-10-30T03:50:45.476Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "896209cdde6c540af93ff82440bb3e303d60a4b7"
---

# TASK-PRF-0161 - Rebuild packages/cli/dist and root-drop and commit every runtime output

## Problem

TASK-PRF-0160 rebuilt dist but its close committed only `release/atm-onefile/*`: tracked outputs under the gitignored `dist/` were classed as generated and dropped, and 11 new runtime modules imported by the rebuilt `atm.js` were never added. The close staging fix (quickfix 43a9586060) makes tracked receipt-owned outputs candidates; the new ignored runtime modules are declared here exactly so close may force-add them.

## Acceptance

- One sealed runner build (`ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build`) from main plus the close staging quickfix, committed as generated outputs only.
- The delivery commit contains the rebuilt tracked `packages/cli/dist` and `release/atm-root-drop` files and the 11 new runtime modules in both trees.
- `scripts/validate-cli-dist-freshness.ts` passes on the result.
- `npm run validate:quick` passes with command-backed evidence.

## Implementation Notes

- Base: main ccea86478b + quickfix 43a9586060. Supersedes the unpushed TASK-PRF-0160 branch.
- Claim as grok-bot (owner-approved 2026-10-30), renew to 14400 s before the sealed build, close through taskflow close.
- New untracked `.d.ts` files and new root-drop source/test/doc mirrors stay out of scope.
