# Atomization Planner Role

## Purpose

`Atomization Planner` is a required advisory role in default Team Agents plans.
It reviews the atomization shape of a task before implementation starts and
surfaces planning risk, map updates, and split recommendations without gaining
write or lifecycle authority.

## Required Behavior

- Read the task scope, deliverables, and atomization impact.
- Identify the primary atom or map under discussion.
- List nearby related atoms that matter to the plan.
- Summarize the command surface that the team plan should consider.
- Flag large-script risk when the task touches known hot files or crosses the
  planning threshold.
- Recommend whether the work should stay advisory or be split into smaller
  atoms.

## Permission Boundary

The role must remain read-only.

- Allowed: `file.read`
- Not allowed: `task.lifecycle`, `git.write`, `file.write`, `evidence.write`

## Default Risk Rule

Treat any plan that touches `tasks.ts`, `next.ts`, `evidence.ts`, or `hook.ts`
as high-risk planning work.

Treat plans that touch more than `3` scoped files as high-risk planning work.

## Required Plan Fields

Team plan JSON should expose these fields:

- `primaryAtom`
- `relatedAtoms`
- `commandSurface`
- `largeScriptRisk`
- `mapUpdateNeed`
- `splitRecommendation`

## Advisory Contract

Atomization Planner output is advisory only.

- It must not open tasks.
- It must not split tasks automatically.
- It must not mutate task lifecycle state.

