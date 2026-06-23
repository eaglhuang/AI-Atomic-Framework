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
