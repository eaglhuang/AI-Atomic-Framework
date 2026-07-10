# Team Role Skill-Pack Contract

Status: draft-v1
Related tasks: `TASK-SKL-0008`, `TASK-SKL-0010`, `TASK-SKL-0011`

This document defines the provider-neutral contract for mapping a Team Agent
role to a low-coupling skill pack.

## Core model

Every Team Agent unit should be described as:

```text
Team Agent = Role + Skill Pack + Permission Lease + Playbook Slice + Growth Contract
```

The objective is to keep skills specialized and composable instead of creating
one oversized "do everything" skill.

## Design rules

- A role defines responsibility and authority boundaries.
- A skill pack defines reusable behavior and knowledge for that role.
- A permission lease defines what the role may actually do at runtime.
- A playbook slice defines when that role participates in a route.
- A growth contract defines how that role learns without polluting other roles.

Coordinator authority remains primary. A role pack must not invent a second task
lifecycle, commit lane, or closeout authority.

## Recommended baseline roles

The default Team Agent vocabulary should support at least:

- `coordinator`
- `scope-guardian`
- `implementer`
- `reviewer`
- `validator`
- `evidence-collector`
- `knowledge-scout`
- `neutral-write-steward`

Roles may be absent in a given team recipe, but new role names should not be
introduced casually. Prefer reusing these baseline semantics when possible.

## Baseline role contract

| Role | Primary purpose | Typical skill-pack focus | Typical permissions |
|---|---|---|---|
| `coordinator` | Own route selection, lifecycle, and final authority | router, dispatch, handoff, sequencing | `task.lifecycle`, `git.write`, `evidence.write` |
| `scope-guardian` | Defend scope and boundary correctness | lock, boundary preflight, scope diagnostics | `file.read` |
| `implementer` | Execute the scoped change | repo-domain implementation skills | `file.write` |
| `reviewer` | Produce findings and return-to-work signals | review heuristics, acceptance reading | `file.read` |
| `validator` | Run validators and interpret failures | evidence and validation orchestration | `exec.validator` |
| `evidence-collector` | Package command-backed evidence and closure hints | evidence surfaces, artifact checks | `file.read`, `evidence.write` only when explicitly delegated by coordinator |
| `knowledge-scout` | Retrieve prior lessons and reusable hints | shared growth, knowledge query, path hints | `file.read` |
| `neutral-write-steward` | Apply bounded writes under broker governance | broker/steward apply flow | bounded write only, no `git.write`, no `task.lifecycle` |

## Skill-pack rules

- A skill pack may contain multiple small skills.
- A role should load only the skills needed for its governed purpose.
- A role should not load unrelated routing or implementation instructions "just
  in case".
- Role packs should prefer shared references and shared growth taxonomy over
  duplicating rules across every skill.

Examples:

- Coordinator pack: `atm-governance-router`, `atm-next`, `atm-dispatch`,
  `atm-handoff`
- Scope Guardian pack: `atm-lock` plus scope/boundary checks
- Validator pack: `atm-evidence` plus validator orchestration guidance
- Knowledge Scout pack: shared growth contract and Team knowledge retrieval

## Authority boundary

Role specialization must never imply lifecycle authority drift.

- Workers do not gain `git.write`.
- Reviewers do not gain `task.lifecycle`.
- Knowledge roles do not gain hidden mutation rights.
- Role packs cannot self-close a task or self-promote evidence.

If a role needs a stronger capability for one route, the playbook must delegate
it explicitly through a scoped lease instead of baking that privilege into the
role's permanent identity.

## Growth compatibility

Every role pack should reuse the shared skill growth contract in
`docs/governance/skills/shared-growth-contract.md`.
Every role pack should also preserve the tool-first orchestration contract in
`docs/governance/skills/tool-first-orchestration.md`, especially when a blocked
tool result carries broker conflict vocabulary.

That keeps growth semantics aligned across:

- entry skills,
- specialist skills,
- Team Agent role packs.

The result is shared learning mechanics with isolated domain memory.

Broker conflict role packs must preserve these shared fields when they appear
in artifacts, evidence, or tool results: `decisionClass`, `decisionReason`,
`violationStatus`, and `broker-conflict-blocked`.

## Observability mapping

Role-pack growth must stay observable from Team runtime surfaces.

- Team plan/start/status should expose enough metadata to map a learning event
  back to the originating role contract and bounded skill pack.
- Observability should distinguish shared ATM routing friction from
  role-specific friction such as lease, scope, or validation boundary drift.
- Raw role-pack lessons should remain reference-first and point back to
  `docs/governance/team-agents/role-pack-learning-loop.md` instead of bloating
  every role entry file.
