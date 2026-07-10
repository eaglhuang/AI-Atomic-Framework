---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-dispatch
title: ATM Dispatch
summary: ATM Captain dispatch routing for task cards, sidecars, subagents, condition review, mailbox work, and closeout coordination.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when the user asks for Captain, Coordinator, dispatch, task
cards, sidecars, subagents, delegation, condition review, mailbox work, or
closeout review.

State `Skill used: atm-dispatch` and the chosen `Delegation mode`.

Terminology boundary: ATM is the product, framework, CLI, and governance workflow. AI-Atomic-Framework is only this repository name; do not call ATM AAF.

Captain must apply atm-dispatch before any dispatch, sidecar delegation,
review, condition review, or closeout.

Delegation modes:

- `local`: the current agent does the work directly.
- `internal sidecar`: Internal sidecar is the default for review, preflight,
  grep, 審稿 / planning-only / checklist, and post-report verification.
- `external handoff`: External dispatch is opt-in. A separate agent/thread may
  receive a bounded task only when the user explicitly chooses that route.

External write is forbidden unless the user explicitly grants write authority
and scope.

{{ACTOR_IDENTITY_HANDOFF_GATE}}

## Dispatch Identity Rule

Captain identity and worker identity are separate authority lanes. A dispatch
card may transfer scope, acceptance criteria, and evidence requirements, but it
must not transfer the captain's runtime identity to the worker.

When assigning work, include the expected actor id or tell the worker to set one
before claiming. When receiving work, the worker must clear stale default
identity if the editor or repo was previously used by another agent, then set its
own actor-scoped identity before claim, edit, close, report, or commit.

## First Command

```bash
{{firstCommand}}
```

After every `next --prompt` or `next --claim` response, read
`evidence.nextAction.playbook` before drafting dispatch instructions, editing,
closing, or committing. The playbook is the short channel-specific work order.

## Dispatch Rules

- Do not create a parallel task model; route task-card work through ATM.
- Do not delegate write authority unless the user explicitly granted it.
- Prefer internal sidecars for review, grep, preflight, checklist, and
  post-report verification.
- Keep sidecars bounded: specify objective, read/write boundary, required
  evidence, stop condition, and report contract.
- For batch work, dispatch only the current queue head unless ATM returns a
  batch route and checkpoint plan.
- For closeout review, verify deliverables and evidence before saying a task is
  complete.

## Team Agents Dispatch Surface

When dispatching or reviewing Team Agents work, preserve the current runtime
surface instead of falling back to the older "manual advisory only" model:

- Use L1 through L5 as the canonical crew scale. L1 is Coordinator,
  Atomization Planner, Implementer, and Validator; L5 adds Lieutenant, Review
  Agent, and Knowledge Scout.
- Mention `--team-size L1..L5` when crew completeness matters, and
  `--role-provider role=provider:model[:sdk][:mode]` when a role needs a
  specific provider/model.
- Treat `team start --execute` as an explicit governed execution lane. The
  default `team start` remains state-only and does not spawn workers.
- Preserve runtime governance fields in reports: `decisionClass`,
  `decisionReason`, `requiresHumanSignoff`, `requiresAdr`,
  `violationStatus`, and `escalationTarget`.
- Treat `broker-conflict-blocked` as a hard stop. Do not tell workers to
  self-close, self-commit, or bypass Team Broker.
- If a task card declares `team.required: true`, closeout needs a completed Team
  run and summary before task close can proceed.

## Route Command

Use this ATM command only after the first command confirms dispatch is the
current governed route:

```bash
{{command}}
```

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}
