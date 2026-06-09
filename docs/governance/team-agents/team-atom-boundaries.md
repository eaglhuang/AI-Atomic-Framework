# Team Command Atom Boundaries

This document records behavior-level atom ownership for the Team CLI command after `TASK-TEAM-0027`. The coarse `atm.team-agents-map` row for whole-file `team.ts` is retired in favor of function-anchored atoms registered in `owner-shard-cli.json`.

## Boundary Mode

`TASK-TEAM-0027` is **split + registration/backfill**: existing logic stays in `team.ts`, but exports and path-map rows now distinguish behavior atoms so parallel Team Agents work can target different anchors on the same file.

## `team.ts` Atoms

| Atom id | Anchor | Primary downstream task |
| --- | --- | --- |
| `team.cli-entry` | `packages/cli/src/commands/team.ts#runTeam` | `TASK-TEAM-0001` |
| `team.recipe-permission-model` | `packages/cli/src/commands/team.ts#validateTeamPermissionModel` | `TASK-TEAM-0001` |
| `team.plan-crew-briefing-contract` | `packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract` | `TASK-TEAM-0002` |
| `team.plan-atomization-planner` | `packages/cli/src/commands/team.ts#buildAtomizationChecklist` | `TASK-TEAM-0003` |
| `team.plan-broker-lane` | `packages/cli/src/commands/team.ts#planTeamBrokerLane` | `TASK-TEAM-0001`, `TASK-CID-0021` |
| `team.start-runtime-state` | `packages/cli/src/commands/team.ts#writeTeamRun` | `TASK-TEAM-0001` |
| `team.status-runtime-read` | `packages/cli/src/commands/team.ts#buildTeamStatusResult` | `TASK-TEAM-0001` |

`TEAM_ATOM_BOUNDARIES` in `team.ts` mirrors this table for runtime introspection.

## `team.spec.ts` Mirror Atoms

| Atom id | Anchor | Mirrors |
| --- | --- | --- |
| `team.spec.command-surface` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecCommandSurface` | CLI entry surface |
| `team.spec.crew-briefing` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecCrewBriefing` | `team.plan-crew-briefing-contract` |
| `team.spec.atomization-planner` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecAtomizationPlanner` | `team.plan-atomization-planner` |
| `team.spec.permission-validation` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecPermissionValidation` | `team.recipe-permission-model` |
| `team.spec.broker-lane` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecBrokerLane` | `team.plan-broker-lane` |
| `team.spec.runtime-status` | `packages/cli/src/commands/command-specs/team.spec.ts#teamSpecRuntimeStatus` | `team.status-runtime-read` |

## Parallel Proof Ownership (`TASK-TEAM-0002` vs `TASK-TEAM-0003`)

For the first same-file different-atom parallel proof:

- **`TASK-TEAM-0002`** owns crew briefing work only:
  - `team.plan-crew-briefing-contract`
  - `team.spec.crew-briefing`
- **`TASK-TEAM-0003`** owns atomization planner work only:
  - `team.plan-atomization-planner`
  - `team.spec.atomization-planner`

These atoms are disjoint. Two workers may edit `team.ts` and `team.spec.ts` concurrently when each worker's task scope lists only its atom anchors. Colliding on the retired coarse `atm.team-agents-map` whole-file owner should produce `blocked-cid-conflict`, not a generic Git merge conflict.

## Path Map Steward Lane

`path-to-atom-map.json` is a merge projection only. Authoritative rows live in `atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json`. Rebuild after shard edits:

```powershell
node atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js . write-projection
```

Concurrent writers to owner shards are forbidden outside a single steward lane.
