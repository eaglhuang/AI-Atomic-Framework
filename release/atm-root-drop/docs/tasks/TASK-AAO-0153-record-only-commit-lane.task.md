---
doc_id: doc_aao_0153
task_id: TASK-AAO-0153
title: "Record-only commit lane for task ledger maintenance"
status: done
owner: atm-core
priority: P1
milestone: RFT-M5
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/git-governance.ts"
  - "packages/cli/src/commands/command-specs/git.spec.ts"
  - "tests/cli/git-record-commit.test.ts"
  - "scripts/validate-cli.ts"
  - "docs/governance/atm-bug-and-optimization-backlog.md"
  - "docs/tasks/TASK-AAO-0153-record-only-commit-lane.task.md"
  - "release/atm-root-drop/"
  - "release/atm-onefile/atm.mjs"
validators:
  - "node --experimental-strip-types tests/cli/git-record-commit.test.ts"
  - "npm run typecheck"
  - "npm run lint"
  - "ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build"
  - "npm run validate:cli -- --mode validate"
  - "npm run validate:root-drop-release"
  - "npm run check:encoding:touched"
  - "node atm.mjs doctor --json"
  - "node atm.mjs hook pre-push --json"
deliverables:
  - "packages/cli/src/commands/git-governance.ts"
  - "packages/cli/src/commands/command-specs/git.spec.ts"
  - "tests/cli/git-record-commit.test.ts"
  - "scripts/validate-cli.ts"
  - "docs/governance/atm-bug-and-optimization-backlog.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert if record-only commits can include source files, closure packets, protected override audit, or repair-like evidence metadata without the existing governed close/repair lane."
atomizationImpact:
  ownerAtomOrMap: "atm.git-governance"
  mapUpdates: []
outOfScope:
  - "Changing taskflow close, closure packet, repair-closure, or protected override semantics"
  - "Adding a broad auto-stage lane for arbitrary .atm files"
  - "Replacing normal task-bound delivery commits"
nonGoals:
  - "Do not relax protected push, closeout, or same-commit provenance checks"
completed_at: "2026-07-09T07:31:08.636Z"
completed_by_agent: "codex-captain"
closedAt: "2026-07-09T07:31:08.636Z"
closedByActor: "codex-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-09T07-31-08-636Z-close-73af2a0895d3"
lastTransitionAt: "2026-07-09T07:31:08.636Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "c846fa7b01d457ab6fb4f732725bdcc557c87749"
---

# TASK-AAO-0153 - Record-only commit lane for task ledger maintenance

## Problem

ATM maintainers still need a task-bound claim/release/commit dance for pure
ledger or `.atm/history` record updates. That keeps surfacing as workflow
friction: harmless record synchronization requires borrowing a delivery-shaped
session even when no product source mutation is occurring.

Backlog source: `ATM-BUG-2026-07-08-058`.

## Acceptance

- Add an official `node atm.mjs git record-commit` lane.
- The lane must not require a task-bound session.
- The lane must require explicit actor identity and a commit message.
- The lane must fail closed when staged files are empty or include non-record
  paths.
- The lane must reject closure packets, protected override audit, and
  repair-like evidence metadata so high-risk boundaries keep using their
  dedicated governed surfaces.
- Same-commit `git-head` provenance must still be staged when governed ledger
  boundary files are committed.
- Help/spec and focused regression coverage must describe the new lane.
- Backlog row `ATM-BUG-2026-07-08-058` must be closed with validator evidence.
