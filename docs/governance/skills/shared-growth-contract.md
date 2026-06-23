# Shared Skill Growth Contract

Status: draft-v1
Related tasks: `TASK-SKL-0007`, `TASK-SKL-0008`, `TASK-SKL-0012`

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
- `repo-specific-but-generalizable`

Skills may add a local subcategory, but they should not replace the shared top
level category set unless a governed task updates this contract.

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

## Team Agents compatibility

This contract is intentionally skill-size-neutral. It applies equally to:

- a large entry skill such as `atm-governance-router`;
- a small specialist skill such as `atm-evidence`;
- a future Team Agent role skill pack such as Coordinator, Validator, or
  Knowledge Scout.

That means Team Agents should not invent a separate memory architecture. Role
packs may keep separate reference files, but they should still use the same
taxonomy, capture fields, and promotion semantics defined here.

## Relationship to Team knowledge

The growth contract is not a second registry and not a replacement for Team
knowledge shards.

- skill learning references teach a skill how to route or act more safely;
- Team knowledge shards provide advisory retrieval for paths, validators,
  lessons, and reuse hints;
- task lifecycle, evidence, and close authority remain under ATM runtime and
  ledger surfaces.

## Minimum adoption bar

An ATM skill can be considered growth-enabled when:

1. `SKILL.md` points to a learning reference instead of embedding raw casework.
2. The learning reference uses the shared taxonomy and capture fields.
3. The promotion rule from reference to `SKILL.md` is explicit.
4. The skill does not silently bypass blocked tool-first or governed routes.
