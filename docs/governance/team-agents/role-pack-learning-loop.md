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
