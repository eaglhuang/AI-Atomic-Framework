# Shared Skill Growth Contract

Status: draft-v1
Related tasks: `TASK-SKL-0005`, `TASK-SKL-0007`, `TASK-SKL-0008`, `TASK-SKL-0012`

This document defines the shared growth architecture for ATM skills. The goal
is to let entry skills, playbook skills, and specialist skills learn from real
execution friction without turning every `SKILL.md` into a long memory dump.

## Why this exists

ATM skills should be the fastest stable entry into governed work. If they only
encode static rules, they become stale. If they absorb every case directly into
`SKILL.md`, they become bloated, expensive, and harder to route correctly.

The shared contract keeps that balance:

- `SKILL.md` holds stable, low-ambiguity rules worth loading every time.
- `references/learning-loop.md` holds reusable wall-hit cases and examples.
- shared taxonomy and capture fields stay consistent across skills.
- role-specific Team Agent packs can reuse the same growth contract later.

## Contract shape

Every ATM skill that opts into growth should follow the same three-layer memory
layout:

1. `SKILL.md`
2. `references/learning-loop.md`
3. shared taxonomy defined by this document or a skill-local projection of it

The shared rule is:

- case first in reference;
- durable pattern later in `SKILL.md`;
- repo-specific facts stay in repo docs or knowledge shards, not in the core
  skill contract.

## Shared taxonomy

Use one of these categories when recording a learning item:

- `entry-friction`
- `route-confusion`
- `boundary-confusion`
- `fallback-misuse`
- `validator-gap`
- `tooling-mismatch`
- `encoding-risk`
- `overloaded-context`
- `shared-atm-routing-friction`
- `role-specific-friction`
- `repo-specific-but-generalizable`

These categories are shared with backlog triage on purpose. A backlog item may
stay open as a product defect while its reusable symptom and safer route are
promoted into skill learning references immediately.

Skills may add a local subcategory, but they should not replace the shared top
level category set unless a governed task updates this contract.

Use `shared-atm-routing-friction` when the wall-hit comes from the common ATM
route, claim, Broker, runner, evidence, or closeout path and would affect more
than one role. Use `role-specific-friction` when the symptom is primarily about
one role's authority boundary, skill-pack scope, or playbook slice. This keeps
Coordinator, Implementer, Validator, Review, and future role packs on the same
taxonomy without merging their role-local memories.

## Shared capture template

Each captured item should record:

- `Category`
- `Trigger`
- `Symptom`
- `Correct route`
- `Durable rule`
- `Promotion target`
- `Confidence`
- `Reuse scope`

Suggested Markdown shape:

```md
## YYYY-MM-DD - short title

- Category: route-confusion
- Trigger: natural-language batch prompt with a planning-repo task lane
- Symptom: the agent almost used low-level lifecycle commands instead of the
  active playbook route
- Correct route: read `nextAction.playbook`, claim only through the governed
  route, and preserve planning/execution repo boundaries
- Durable rule: when batch is active, the playbook owns sequencing; do not
  hand-roll lifecycle loops
- Promotion target: learning-loop.md
- Confidence: high
- Reuse scope: all ATM entry and dispatch skills
```

## Backlog-to-skill promotion

Treat the ATM bug backlog as a feeder system for reusable skill knowledge, not
just a repair queue.

- Keep the product defect in backlog when code or workflow still needs a fix.
- Promote the reusable operator lesson into a shared or skill-local learning
  reference as soon as the route is clear enough to help the next run.
- Promote into `SKILL.md` only after the lesson meets the normal promotion bar.

Use this triage split:

- `Bug only`: implementation defect with no stable operator rule yet.
- `Skill lesson only`: operator-facing pattern with no product change needed.
- `Both`: the system needs a fix and the skill also needs to know how not to
  get lost before that fix lands.

Starter backlog-fed lessons:

- `ATM-BUG-2026-06-23-019`
  - Category: `entry-friction`
  - Reusable lesson: when imported prompt-scoped tasks already exist in the
    JSON ledger, prefer ledger truth over repeated planning-root rediscovery.
- `ATM-BUG-2026-06-23-020`
  - Category: `boundary-confusion`
  - Reusable lesson: after planning-repo reconcile or close, verify whether
    the target repo still holds a stale imported snapshot before trusting a
    dependency blocker.
- `ATM-BUG-2026-06-23-021`
  - Category: `tooling-mismatch`
  - Reusable lesson: when host and framework runners expose different command
    surfaces, diagnose capability skew before treating operator failure as a
    normal lifecycle blocker.
- `ATM-BUG-2026-06-24-022`
  - Category: `tooling-mismatch`
  - Reusable lesson: when a fix changes frozen-runner behavior, source-first
    success is not enough; retain release outputs with
    `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` and rerun `node atm.mjs`
    before claiming the frozen entrypoint is updated.

## Promotion policy

Promote a learning item from a reference file into `SKILL.md` only when one or
more of the following are true:

1. The same mistake happened at least twice.
2. The mistake risks ATM bypass, unsafe edits, wrong claim order, or wrong
   close/commit timing.
3. The fix can be expressed as a short general rule with broad reuse value.

Do not promote:

- one-off user preference;
- host-only trivia better kept in repo docs;
- long narrative examples that belong in learning references.

Repeated hardening themes such as stale imported task truth, runner skew,
historical closeback mismatch, or residue cleanup should usually live in
learning references first and become core skill rules only after repetition.

Another high-value example is runner-sync misread: if a dogfood lane fixes
`CLI`, `close`, `taskflow`, `hook`, or `evidence` code, but validation stops at
`node atm.dev.mjs`, the skill should treat frozen-runner verification as still
unproven until a retained build and frozen rerun happen.

## Historical demotion policy

Growth memory also needs a slimming path. When a bug is fixed or a workaround
is no longer part of the preferred route, the lesson should be reviewed and
possibly moved out of the active learning surface.

Use this lifecycle:

- `Active`: the bug or friction still exists, or the lesson is still needed as
  part of the normal operator route.
- `Watch`: the product fix landed, but we still want short-term observation in
  case the symptom repeats.
- `Historical`: the fix is stable and the lesson no longer needs to load in the
  default skill-growth path.

Demote a lesson from active references when all are true:

1. The related bug is fixed or the product gap is intentionally closed.
2. The safer route is no longer a common operator decision point.
3. Keeping the lesson active would mostly add noise or token cost.

When demoting:

- keep a short historical note or archive entry for traceability;
- remove or shorten the active reference so future skill loads stay lean;
- do not keep obsolete workaround text in `SKILL.md`.
- if the lesson came from backlog, move the narrative workaround out of the
  active learning surface and retain only the stable post-fix rule or archive
  pointer.

This means backlog-fed knowledge is not append-only. Skills should learn fast,
then shed solved wall-hits into history once the product no longer needs that
live caution.

## Team Agents compatibility

This contract is intentionally skill-size-neutral. It applies equally to:

- a large entry skill such as `atm-governance-router`;
- a small specialist skill such as `atm-evidence`;
- a future Team Agent role skill pack such as Coordinator, Validator, or
  Knowledge Scout.

That means Team Agents should not invent a separate memory architecture. Role
packs may keep separate reference files, but they should still use the same
taxonomy, capture fields, and promotion semantics defined here.

Team plans expose this stitching through
`atm.teamRoleGrowthObservabilityContract.v1`. The contract maps each role to a
skill pack, playbook slice, shared taxonomy, and reference-first learning
target. A role learning event should be observable as a governance artifact,
but the raw lesson still lands first in
`docs/governance/team-agents/role-pack-learning-loop.md` instead of being copied
into every role entry file.

The shared M8E Broker vocabulary is part of the growth taxonomy bridge:
`decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked`. Team role growth should track
`broker-conflict-blocked.hit-rate` as an observability metric when Broker
conflict events or role learning artifacts report that state.

## Relationship to Team knowledge

The growth contract is not a second registry and not a replacement for Team
knowledge shards.

- skill learning references teach a skill how to route or act more safely;
- Team knowledge shards provide advisory retrieval for paths, validators,
  lessons, and reuse hints;
- task lifecycle, evidence, and close authority remain under ATM runtime and
  ledger surfaces.

## Relationship to tool-first orchestration

The tool-first orchestration contract in
`docs/governance/skills/tool-first-orchestration.md` is the execution-order
companion to this growth contract.

- tool-first orchestration decides whether to use a structured tool, official
  CLI fallback, or read-only shell inspection;
- shared growth decides where reusable lessons about that route should live;
- blocked tool results should become learning items before they become
  permanent `SKILL.md` rules.

## Minimum adoption bar

An ATM skill can be considered growth-enabled when:

1. `SKILL.md` points to a learning reference instead of embedding raw casework.
2. The learning reference uses the shared taxonomy and capture fields.
3. The promotion rule from reference to `SKILL.md` is explicit.
4. The skill does not silently bypass blocked tool-first or governed routes.
