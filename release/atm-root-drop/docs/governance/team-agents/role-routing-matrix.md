# Team Role Routing Matrix

Status: draft-v1
Related tasks: `TASK-SKL-0009`, `TASK-SKL-0010`

This document explains how playbooks route work to role skill packs without
making the first-touch router too large.

## Layer model

ATM Team routing should stay split across three layers:

1. Router layer
2. Playbook layer
3. Role skill-pack layer

## Layer responsibilities

### Router layer

The router decides whether the work should enter ATM and whether the route needs
Team coordination at all.

Typical surfaces:

- `atm-governance-router`
- `atm-dispatch`
- `atm-task-intent-resolver`

The router should not carry the full role-by-role execution logic.
It should also follow the tool-first orchestration contract in
`docs/governance/skills/tool-first-orchestration.md`: use structured ATM tool
results when available, preserve blocked route truth, and hand the actual
work order to the playbook or specialist role pack.

### Playbook layer

The playbook is the dynamic route order for the current task or batch head. It
decides:

- which roles are needed;
- whether work is sequential or parallel;
- which roles are advisory only;
- which role receives a scoped lease;
- when evidence, checkpoint, close, or commit gates apply.

This is the middle layer between a thin router and specialized role packs.

### Role skill-pack layer

Each role pack receives a narrow workstream and should focus on one governance
purpose.

The role pack consumes the playbook slice selected by the Coordinator. It may
return findings, validator output, implementation notes, or Broker status, but
it does not select a new ATM channel or lifecycle route on its own.

## Baseline routing matrix

| Workstream | Primary role | Supporting roles | Advisory roles | Playbook slice |
|---|---|---|---|---|
| Entry and route selection | `coordinator` | `scope-guardian` | `knowledge-scout` | entry |
| Planning-repo boundary check | `scope-guardian` | `coordinator` | `knowledge-scout` | boundary |
| Implementation | `implementer` | `coordinator` | `reviewer` | execution |
| Validation | `validator` | `implementer` | `knowledge-scout` | validation |
| Evidence packaging | `evidence-collector` | `validator`, `coordinator` | `reviewer` | evidence |
| Bounded broker apply | `neutral-write-steward` | `coordinator` | `scope-guardian` | steward |
| Review loop | `reviewer` | `implementer` | `knowledge-scout` | review |
| Final close/commit | `coordinator` | `validator`, `evidence-collector` | `scope-guardian` | closeout |

## Playbook slice contract

A playbook slice is the route-local handoff contract between the Coordinator
and role skill packs. It must describe:

- `roleOrder`: the sequence that owns route progression;
- `parallelSafeRoles`: roles that may inspect or prepare context without
  mutating shared state;
- `advisoryOnlyRoles`: roles that may return findings but must not write,
  claim, close, or commit;
- `lifecycleOwner`: always `coordinator`;
- `stopConditions`: ATM or Broker states that must halt progression.

The canonical CLI artifact is `atm.teamRoleRoutingMatrix.v1`. Team runtime,
Captain UX, and future provider bridges should consume this matrix instead of
creating a second Team playbook.

## Canonical route slices

| Workstream | `roleOrder` | `parallelSafeRoles` | `advisoryOnlyRoles` | Stop conditions |
|---|---|---|---|---|
| `task-entry-routing` | `coordinator` -> `scope-guardian` / `reader` -> optional `evidence-collector` | `reader`, `evidence-collector` | `evidence-collector` | `broker-conflict-blocked`, `blocked-active-lease`, `proposal-submitted` |
| `scoped-implementation` | `coordinator` -> `scope-guardian` -> `implementer` -> optional `reader` | `scope-guardian`, `reader` | `reader` | `broker-conflict-blocked`, `blocked-active-lease`, `proposal-submitted` |
| `validation-and-evidence` | `coordinator` -> `validator` -> `evidence-collector` -> optional `reader` | `evidence-collector`, `reader` | `reader` | `broker-conflict-blocked`, `blocked-active-lease`, `proposal-submitted` |
| `broker-conflict-resolution` | `coordinator` -> `scope-guardian` -> optional `reader` / `evidence-collector` | `reader`, `evidence-collector` | `reader`, `evidence-collector` | `broker-conflict-blocked`, `missing-atm.brokerConflictResolution.v1`, `manual-runtime-edit-requested` |

The slash in `roleOrder` means the roles are ordered after the previous owner
but may run in either order relative to each other when they are also listed in
`parallelSafeRoles`.

## Broker stop states

Team Broker results are route truth for write admission. A role pack must stop
and return control to Coordinator when any of these states appears:

| Broker signal | Role-pack response | Coordinator response |
|---|---|---|
| `broker-conflict-blocked` | Preserve `decisionClass`, `decisionReason`, and `violationStatus`; do not write | Run the conflict-resolution playbook and serialize release order |
| `blocked-active-lease` | Report the blocking task, lease, and `blockedReasons` | Release or repair only with official CLI surfaces, then rerun Broker status |
| `proposal-submitted` | Treat the lane as provisional, not admitted | Complete proposal-first admission or narrow the actual write scope |
| `needs-steward` / steward apply required | Do not apply directly | Route through neutral-write-steward and keep Broker evidence |

The `broker-conflict-resolution` slice must preserve the shared M8E vocabulary
without renaming it: `decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked`. The Coordinator may run
`team broker resolve` to produce an `atm.brokerConflictResolution.v1`
artifact, but role packs must not suggest manual edits to `.atm/runtime/**` or
invent an alternate release order.

## Captain conflict UX

When a Broker conflict blocks an entrypoint, Captain-facing output must show the
same operator fields as the `broker-conflict-resolution` slice:

- `blockedTaskIds`: the tasks currently held behind the release order;
- `sharedPaths` or `overlappingAtomIds`: the shared file or atom surface that
  caused the block;
- `decisionClass`, `decisionReason`, and `violationStatus`;
- `requiredResolutionArtifact`: `atm.brokerConflictResolution.v1`;
- `nextSafeResolutionCommand`: the `team broker resolve` command that produces
  the artifact.

This UX is a projection of the canonical route matrix, not a second playbook.
If `violationStatus` is `broker-conflict-blocked`, Coordinator stops write
progression, creates or consumes the `atm.brokerConflictResolution.v1` artifact,
then releases tasks in order. Manual edits to `.atm/runtime/**` are outside the
Captain path.

## Why this matters

This matrix keeps the first skill small:

- the router remains an ATM entrypoint, not a giant execution bundle;
- playbooks own per-route orchestration;
- each role pack only loads the skills needed for its domain;
- shared growth stays reusable without forcing every role to load every rule.

## Guardrails

- Playbooks may select roles, but they do not change role authority semantics.
- Role packs may advise or execute within lease scope, but they do not own task
  lifecycle.
- No layer may create a second governance model outside the existing ATM
  lifecycle.
- Blocked Broker decisions stay blocked until the Coordinator follows the
  official recovery route; role packs must not translate them into ad hoc
  shell workarounds.
