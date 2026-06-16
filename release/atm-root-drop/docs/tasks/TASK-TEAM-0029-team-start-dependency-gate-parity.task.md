---
task_id: TASK-TEAM-0029
title: Team start dependency gate parity
status: planned
owner: codex-teamagents-dogfood
priority: P1
depends_on:
  - TASK-TEAM-0011
  - TASK-TEAM-0015
related_plan: docs/governance/team-agents/minimal-task-crew.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/team.ts
  - packages/cli/src/commands/command-specs/team.spec.ts
  - packages/cli/src/commands/tasks/dependency-gates.ts
  - scripts/validate-team-agents.ts
  - scripts/validate-cli.ts
  - docs/governance/team-agents/minimal-task-crew.md
  - atomic_workbench/atomization-coverage/path-to-atom-map.json
deliverables:
  - packages/cli/src/commands/team.ts
  - packages/cli/src/commands/command-specs/team.spec.ts
  - scripts/validate-team-agents.ts
  - scripts/validate-cli.ts
  - docs/governance/team-agents/minimal-task-crew.md
  - atomic_workbench/atomization-coverage/path-to-atom-map.json
validators:
  - npm run typecheck
  - npm run validate:cli
  - node --strip-types scripts/validate-team-agents.ts --case claim-gate-parity
  - git diff --check
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the team start claim-gate integration, fixtures, docs, and atom-map updates if it blocks legitimate claimable team starts or diverges from the normal ATM task lifecycle.
atomizationImpact:
  ownerAtomOrMap: atm.team-agents-map
  mapUpdates:
    - atomic_workbench/atomization-coverage/path-to-atom-map.json
outOfScope:
  - Spawning real external subagents
  - Changing `next --claim` dependency semantics
  - Allowing `team start` to reserve, promote, or claim tasks by itself
  - Broad task lifecycle rewrites outside Team Agents start/plan/validate parity
nonGoals:
  - Do not make Team Agents mandatory for normal single-agent tasks
  - Do not create a second task truth source
  - Do not weaken dependency gates to make team start easier
tags:
  - team-agents
  - task-lifecycle
  - dependency-gate
  - dogfood
---

# TASK-TEAM-0029: Team start dependency gate parity

## Context

During Team Agents dogfooding, `TASK-APO-0029` exposed a lifecycle mismatch:
`node atm.mjs next --claim ...` correctly failed with
`ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED` because dependency `TASK-APO-0028` was
missing, but `node atm.mjs team start --task TASK-APO-0029 ...` still created an
active manual team run under `.atm/runtime/team-runs/**`.

That means Team Agents can currently produce a valid plan and runtime team record
for a task that the normal ATM claim gate would not admit. Team Agents should be
subordinate to the same task lifecycle gates as normal governed development.

The same dogfood cleanup also exposed an abandoned-task lifecycle gap: any task
card should be allowed to close as `abandoned` with a human-readable reason only.
Abandoned means "stop tracking this card for now", not "delivery completed".
It should not require validators, command-backed evidence, a fresh claim, or a
fake delivery packet, and the card may be reopened later through a governed
lifecycle transition when someone wants to track it again.

## Goal

Make `team start` fail closed when the selected task is not claim-admissible due
to missing, open, blocked, review, or otherwise incomplete dependencies. Keep
`team plan` and `team validate` useful as advisory dry-run surfaces, but make the
unsafe-to-start reason visible there too.

Also make abandoned-task close semantics explicit: `tasks close --status
abandoned --reason <text>` is valid for any task card with a reason, does not
require delivery evidence, and leaves a future reopen path available.

## Acceptance Evidence

- `team start --task <id> --actor <actor> --json` fails closed when the same task
  would be blocked by `next --claim` dependency gating.
- The blocked response names the dependency task ids, their statuses, and the
  exact recovery/status command, matching the `next --claim` dependency-blocked
  contract.
- `team plan` and `team validate` may remain dry-run advisory surfaces, but their
  output clearly marks when a task is not safe to start because claim admission
  would fail.
- A regression fixture covers a task whose dependency is missing or not done, and
  proves no `.atm/runtime/team-runs/**` file is written in that blocked case.
- A regression fixture covers a claimable task and proves `team start` still
  writes one runtime team run with `agentsSpawned: false`.
- CLI help and Team Agents docs explain that `team start` is subordinate to
  normal ATM claim/dependency admission and is not a bypass.
- `tasks close --status abandoned --reason <text>` succeeds for any task card
  without requiring validators, command-backed evidence, or a fresh claim.
- Abandoned close stages/records only the task ledger and task-event files that
  actually exist, never a missing `.atm/history/evidence/<task>.json`.
- A reopened abandoned task can return to tracking through an explicit governed
  transition, without treating the earlier abandon as delivery completion.

## Implementation Notes

- Reuse the existing dependency gate logic used by `next --claim` rather than
  introducing a Team Agents-only dependency checker.
- Keep `team start` from mutating `.atm/runtime/team-runs/**` when the dependency
  gate fails.
- Treat `abandoned` as a reasoned lifecycle stop, not as a delivery close. It
  should be less strict than `done`, not a special case that needs emergency
  commit bypass.
- Preserve the existing manual-team behavior for claimable tasks:
  `agentsSpawned: false`, a single runtime team run file, and no `.atm/history/**`
  writes.
- Prefer a focused validator case in `scripts/validate-team-agents.ts` so this
  dogfood failure cannot regress quietly.

## Rollback

Revert the implementing commit. If the change adds fixture task files or runtime
test data, remove those fixtures with the same revert so Team Agents returns to
the previous start/status behavior.
