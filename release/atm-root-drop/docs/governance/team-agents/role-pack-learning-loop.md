# Team Role Pack Learning Loop

Status: draft-v1
Related tasks: `TASK-SKL-0007`, `TASK-SKL-0012`

This document is the Team Agent role-pack reference layer for raw cases,
examples, and reusable friction notes. It works together with:

- `docs/governance/skills/shared-growth-contract.md`
- `docs/governance/team-agents/role-skill-pack-contract.md`

## Purpose

Use this document when a Team role pack hit a real wall and the lesson is worth
keeping, but is not yet stable enough to promote into a role-pack core rule or
shared skill contract.

## Capture shape

Record lessons using the shared growth fields:

- `Category`
- `Trigger`
- `Symptom`
- `Correct route`
- `Durable rule`
- `Promotion target`
- `Confidence`
- `Reuse scope`

## Promotion rule

- Raw Team role-pack cases stay here first.
- Durable, cross-role routing rules may graduate into
  `docs/governance/skills/shared-growth-contract.md`.
- Stable role-boundary rules may graduate into
  `docs/governance/team-agents/role-skill-pack-contract.md`.

## Example stub

```md
## YYYY-MM-DD - short title

- Category: role-specific-friction
- Trigger: a validator role attempted to widen scope after a failed check
- Symptom: the role drifted from validation into lifecycle control
- Correct route: keep validator advisory and return control to coordinator
- Durable rule: validator findings may redirect work, but validators do not own
  lifecycle
- Promotion target: role-pack-learning-loop.md
- Confidence: medium
- Reuse scope: validator and evidence-collector packs
```

## Active runtime-observability cases

## 2026-07-10 - Team role growth observability remains reference-first

- Category: shared-atm-routing-friction
- Trigger: `TASK-SKL-0012` needed role learning events to be observable across
  Coordinator, Implementer, Validator, Review, and future role packs without
  creating a second memory product
- Symptom: role packs needed a way to map learning events back to
  `skillPackId`, `playbookSlice`, and shared taxonomy while keeping raw cases
  out of every role entry file
- Correct route: expose `atm.teamRoleGrowthObservabilityContract.v1` from Team
  plan/runtime surfaces, project role learning as governance artifact output,
  and keep raw lessons in this reference file until a durable rule is promoted
- Durable rule: role-growth observability is a mapping layer, not a memory
  store; it must distinguish `shared-atm-routing-friction` from
  `role-specific-friction`
- Promotion target: role-skill-pack-contract.md and shared-growth-contract.md
- Confidence: high
- Reuse scope: coordinator, implementer, validator, reviewer,
  evidence-collector, knowledge-scout packs

## 2026-07-10 - stale Broker lease should become observable friction

- Category: shared-atm-routing-friction
- Trigger: after `TASK-SKL-0011` was closed, `team plan` for `TASK-SKL-0012`
  initially saw a stale `TASK-SKL-0011` active Broker intent
- Symptom: Team Broker reported `blocked-active-lease` and required cleanup
  before the new role-growth work could proceed
- Correct route: use the official `broker release --task <task-id>` route for
  stale write intents, rerun `broker status`, and rerun `team plan`
- Durable rule: stale Broker registry friction should be recorded as shared
  ATM routing friction, while role-boundary failures stay role-specific
- Promotion target: shared-growth-contract.md
- Confidence: high
- Reuse scope: coordinator and scope-guardian packs

## 2026-07-10 - proposal-first Broker gate preserves role-pack authority

- Category: role-specific-friction
- Trigger: `TASK-SKL-0008` was claimed with a scope that included
  `packages/cli/src/commands/team.ts`, so `team plan` entered the hot-file
  proposal-first lane
- Symptom: `team validate` passed permission checks, but `team plan` reported
  `safeToStart=false` with the Broker reason "Proposal-first lane is active;
  broker recorded a provisional write lease before final admission."
- Correct route: keep Coordinator authority primary, avoid touching the hot
  file unless the proposal-first admission is completed, and deliver the role
  contract through non-hot docs/integration surfaces when that satisfies the
  task acceptance
- Durable rule: a role pack may observe `parallel-safe` while still blocked by
  admission state; `parallel-safe` is not write permission when Broker also
  reports a provisional or blocked lane
- Promotion target: role-skill-pack-contract.md and role-routing-matrix.md
- Confidence: high
- Reuse scope: coordinator, implementer, scope-guardian, validator packs

## 2026-06-24 - blocked runtime pilot still maps cleanly to role contracts

- Category: role-specific-friction
- Trigger: `team plan` for a hot-file pilot task hits broker lease takeover and
  cannot start a worker write lane yet
- Symptom: the pilot is blocked before runtime start, but the team surface
  still needs to show which role pack, playbook slice, and authority boundary
  were involved
- Correct route: keep the blocker observable on the team plan/runtime pilot
  surface, return lifecycle control to Coordinator, and record the lesson here
- Durable rule: blocked pilots still need role-pack observability; failure is
  evidence, not a reason to collapse back into one giant skill
- Promotion target: role-pack-learning-loop.md
- Confidence: medium
- Reuse scope: coordinator, implementer, validator packs

## 2026-06-24 - source-first pass did not prove frozen team runner

- Category: tooling-mismatch
- Trigger: `TASK-SKL-0011` and `TASK-SKL-0012` changed Team runtime / CLI
  surfaces, but validation initially stopped at `node atm.dev.mjs`
- Symptom: the lane looked fixed in source-first validation while
  `node atm.mjs` still served stale frozen artifacts, which could mislead role
  packs into trusting the wrong runtime state
- Correct route: retain release artifacts with
  `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build`, rerun the frozen entrypoint,
  and only then claim proof for Team runtime delivery
- Durable rule: Team role-pack work that touches CLI, close, taskflow, or
  runtime-start surfaces must treat source-first success as advisory until the
  frozen runner is rebuilt and checked
- Promotion target: shared-growth-contract.md and role-pack-learning-loop.md
- Confidence: high
- Reuse scope: coordinator, validator, runtime-pilot dogfood lanes

## Historical section

Move solved runtime-observability workarounds here once the underlying product
fix is stable and the lesson no longer needs to load by default.
