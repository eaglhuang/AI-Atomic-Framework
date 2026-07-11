# Team Role Skill-Pack Contract

Status: draft-v1
Related tasks: `TASK-SKL-0008`, `TASK-SKL-0010`, `TASK-SKL-0011`, `TASK-SKL-0012`

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

Cross-vendor role output first becomes `atm.teamProviderRunArtifact.v1`.
Only the Coordinator/system materialization lane may derive a
`atm.teamRoleHandoffArtifact.v1` reference envelope. The envelope expresses
handoff producers, consumers, rework routes, and permitted same-task
continuations through `consumesFrom`, `producesTo`, and `requiredArtifacts`;
it never duplicates vendor output or grants a role direct history access.

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

## Capability boundary matrix

Every role pack must expose the same four boundary fields. This keeps a Team
role concrete enough for tools and humans to inspect without turning the role
into a second scheduler.

| Role | Allowed permissions | Forbidden permissions | Expected playbook slice | Growth attachment point |
|---|---|---|---|---|
| `coordinator` | `task.lifecycle`, `git.write`, `evidence.write`; read-only inspection needed to route work | direct implementation writes unless also acting under a separate scoped implementer lease | entry, claim, sequencing, close, commit, handoff | shared routing lessons in `docs/governance/skills/shared-growth-contract.md`; role cases in `docs/governance/team-agents/role-pack-learning-loop.md` |
| `scope-guardian` | `file.read`; scope, lock, direction-lock, and broker status inspection | `file.write`, `git.write`, `task.lifecycle`, self-close | boundary preflight, overlap review, out-of-scope warning | scope and lease lessons in `docs/governance/team-agents/role-pack-learning-loop.md` |
| `implementer` | `file.write` only for explicitly leased target files; read access to task card and accepted context | `git.write`, `task.lifecycle`, `evidence.write`, self-close, widening scope | scoped delivery and implementation notes | implementation friction first lands in `docs/governance/team-agents/role-pack-learning-loop.md`; cross-role durable rules promote to shared growth |
| `reviewer` | `file.read`; findings, return-to-work signals, and acceptance comparison | `file.write`, `git.write`, `task.lifecycle`, evidence promotion | review loop and acceptance check | review patterns remain role-local unless they change global ATM routing |
| `validator` | `exec.validator`; read access to touched files and validator configs | `file.write`, `git.write`, `task.lifecycle`, self-close | validator execution, failure interpretation, rerun budget | validator-result lessons attach to role-pack learning, then promote to shared growth when reusable |
| `evidence-collector` | `file.read`; `evidence.write` only when Coordinator delegates it explicitly | `git.write`, `task.lifecycle`, implementation writes, self-close | evidence packaging, artifact manifest review, close-readiness summary | evidence-shape lessons attach to shared growth only after they are stable across roles |
| `knowledge-scout` | `file.read`; knowledge query and prior-case retrieval | `file.write`, `exec.mutating`, `git.write`, `task.lifecycle` | advisory context retrieval before or during playbook execution | lessons stay reference-first and must not mutate role authority |
| `neutral-write-steward` | broker-authorized bounded apply for a named merge plan or proposal | `git.write`, `task.lifecycle`, self-close, unbounded source edits | steward apply after Broker/Coordinator approval | steward lessons attach to role-pack learning and must preserve Broker evidence ids |

## Skill-pack rules

- A skill pack may contain multiple small skills.
- A role should load only the skills needed for its governed purpose.
- A role should not load unrelated routing or implementation instructions "just
  in case".
- Role packs should prefer shared references and shared growth taxonomy over
  duplicating rules across every skill.
- A role pack receives a playbook slice. It does not choose a different channel,
  close a task, or commit unless the Coordinator explicitly owns that action.
- A role pack that sees a blocked ATM tool result must preserve the blocked
  status and return it to the Coordinator instead of inventing a fallback path.

Examples:

- Coordinator pack: `atm-governance-router`, `atm-next`, `atm-dispatch`,
  `atm-handoff`
- Scope Guardian pack: `atm-lock` plus scope/boundary checks
- Validator pack: `atm-evidence` plus validator orchestration guidance
- Knowledge Scout pack: shared growth contract and Team knowledge retrieval

## Provider-Neutral Manifest

`atm.teamRoleSkillPackManifest.v1` is the machine-readable stitching layer for
role packs. It does not merge SKL role contracts into Team Broker runtime
implementation; it records the common vocabulary that provider bridges and
role packs must preserve.

The manifest is role-first and provider-second:

- `roleFirstProviderSecond: true` means provider selection cannot redefine role
  authority.
- `discoveryMode: capability-driven` means a provider or runtime is listed only
  as a way to satisfy the role pack capabilities, not as the owner of the role.
- `permissionLease.alignment: role-first` means allowed and forbidden
  permissions come from the role contract before provider choice.
- `providerCapabilities[]` lists which provider/runtime/artifact surfaces can
  satisfy the role pack.

The manifest must preserve the shared Broker conflict vocabulary:
`decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked`.

## Agent+Skill runtime pilot

`atm.teamRuntimePilot.v1` is the first concrete pilot surface for the
Agent+Skill model. It proves the contract with a small role trio rather than a
full swarm rollout:

- `coordinator` loads `atm.role-pack.coordinator` and remains the only owner of
  task lifecycle, closeout, and `git.write`.
- `implementer` loads `atm.role-pack.implementer` only for scoped delivery
  under the task lease.
- `validator` loads `atm.role-pack.validator` only for validator execution and
  evidence interpretation.

The pilot must expose `agentSkillUnits[]` so operators can inspect each
role's skill pack, lease permissions, forbidden permissions, and playbook
slice. It must also expose `workflowEvidence` and `roleConfusionMetrics` so a
blocked or successful run still explains whether role confusion decreased.

The pilot is allowed to stop before runtime start when Team Broker reports
`proposal-submitted`, `blocked-active-lease`, or `broker-conflict-blocked`.
That stop is evidence, not failure theater. The role pack must preserve
`decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked` on the pilot surface and hand control back to the
Coordinator.

## Authority boundary

Role specialization must never imply lifecycle authority drift.

- Workers do not gain `git.write`.
- Reviewers do not gain `task.lifecycle`.
- Knowledge roles do not gain hidden mutation rights.
- Role packs cannot self-close a task or self-promote evidence.

If a role needs a stronger capability for one route, the playbook must delegate
it explicitly through a scoped lease instead of baking that privilege into the
role's permanent identity.

Team Broker authority is a separate boundary. When Broker reports
`broker-conflict-blocked`, `blocked-active-lease`, `proposal-submitted`, or any
other blocked admission state, role packs must stop write progression and hand
the decision back to the Coordinator with the original Broker fields intact.
Coordinator may sequence recovery, but Coordinator does not silently override
Broker conflict authority.

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

When those fields are absent but a Broker result is still blocked, role packs
should keep the nearest available structured fields such as `verdict`, `lane`,
`admission.state`, `failureReason`, and `blockedReasons`. The shared vocabulary
is the preferred contract for M8E conflict UX; the fallback fields preserve
truth until all lanes emit the M8E shape.

## Observability mapping

Role-pack growth must stay observable from Team runtime surfaces.

- Team plan/start/status should expose enough metadata to map a learning event
  back to the originating role contract, bounded skill pack, and playbook slice.
- Observability should distinguish shared ATM routing friction from
  role-specific friction such as lease, scope, or validation boundary drift.
- Raw role-pack lessons should remain reference-first and point back to
  `docs/governance/team-agents/role-pack-learning-loop.md` instead of bloating
  every role entry file.

`atm.teamRoleGrowthObservabilityContract.v1` is the machine-readable mapping
for that rule. It projects role learning through the existing
`atm.teamAgentObservabilityEvent.v1` surface by treating learning captures as
`artifact.output` events with artifact type
`atm.teamRoleGrowthLearningItem.v1`. The projected artifact uses the shared
capture fields from `docs/governance/skills/shared-growth-contract.md`, while
the Team plan keeps the durable mapping:

- role -> `agentId`;
- role -> `skillPackId`;
- role -> `playbookSlice`;
- role -> `growthContractAttachment`;
- role -> reference target.

The contract also separates:

- `shared-atm-routing-friction`: entry, route, fallback, tooling, Broker, or
  closeout friction that can affect several roles;
- `role-specific-friction`: boundary, scope, validator, context, or
  permission-lease friction tied to one role pack.

Broker conflict growth must keep the M8E vocabulary intact. The shared
observability metric is `broker-conflict-blocked.hit-rate`, keyed by
`decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked`, so role packs can learn from Broker blocks without
creating a second release-order source.
