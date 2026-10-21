---
doc_id: doc_TASK-PRF-0150
task_id: TASK-PRF-0150
title: 'Governance friction quick fixes: one-line results, pre-close check, help snapshot regen, stale tests'
status: done
owner: grok-bot
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0150.*
- .atm/history/task-events/TASK-PRF-0150/**
- .atm/history/tasks/TASK-PRF-0150.json
- .atm/task-plans/TASK-PRF-0150.md
- AGENTS.md
- package.json
- scripts/lib/atm-result-line.ts
- scripts/sealed-build-log-sink.ts
- scripts/preclose-check.ts
- scripts/update-help-snapshots.ts
- scripts/run-sealed-runner-build.ts
- scripts/run-cli-test-sweep.ts
- scripts/validate-cli/**
- tests/cli/atm-result-line.test.ts
- tests/cli/sealed-build-log-sink.test.ts
- tests/cli/help-snapshots.test.ts
- tests/cli/preclose-check.test.ts
- tests/cli/cli-test-sweep.test.ts
- tests/core/transactional-steward-single-write.test.ts
- packages/cli/src/commands/git-governance/implementation/commit-bundle-resolution.test.ts
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/atm-result-line.test.ts
- node --strip-types tests/cli/sealed-build-log-sink.test.ts
- node --strip-types tests/cli/help-snapshots.test.ts
- node --strip-types tests/cli/preclose-check.test.ts
- node --strip-types tests/cli/cli-test-sweep.test.ts
- node --strip-types tests/core/transactional-steward-single-write.test.ts
- node --strip-types packages/cli/src/commands/git-governance/implementation/commit-bundle-resolution.test.ts
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types scripts/preclose-check.ts
deliverables:
- scripts/lib/atm-result-line.ts
- scripts/sealed-build-log-sink.ts
- scripts/preclose-check.ts
- scripts/update-help-snapshots.ts
- AGENTS.md
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- No change to taskflow close semantics or product runtime code.
- Hard proposals (detached close, bundle filtering, amend path, CLI-wide result line, validator reuse, ship wrapper) are design-only in a separate PR.
- Do not tag or publish npm.
completed_at: "2026-10-21T01:09:34.293Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T01:09:34.293Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T01-09-34-293Z-close-ffbc9954585e"
lastTransitionAt: "2026-10-21T01:09:34.293Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "185e070673e36cae8493038c9e8c1dcc12c13250"
---

# TASK-PRF-0150 — governance friction quick fixes

## Authority and scope

User 文一 asked on 2026-10-21 (Asia/Taipei) to list the friction hit while using ATM's own governance for the paper-2.0 write-path fixes, quick-fix the easy items, and propose the hard ones. All code is written by the box Codex CLI.

## Design

- `scripts/lib/atm-result-line.ts`: one fixed result line `ATM-RESULT step= status= code= log= hint=`.
- Sealed build (`ATM_BUILD_LOG_FILE`) and CLI test sweep (`ATM_SWEEP_LOG_FILE`): opt-in log-file mode, stdout is one result line. Default behaviour unchanged.
- `npm run preclose:check`: repository 600-line budget + CLI help snapshot comparison before close.
- `npm run help-snapshots:update`: regenerate help snapshots from CLI JSON help.
- Update two stale tests to current contracts (#363 stale-base re-compose; foreign staged deletion reported as out-of-scope staged file).
- AGENTS.md: token-efficient governance runs guidance.

## Acceptance

- New tests pass; both previously failing tests pass; physical-line-budget gate and typecheck pass.
- `help-snapshots:update` on clean main produces no diff.
