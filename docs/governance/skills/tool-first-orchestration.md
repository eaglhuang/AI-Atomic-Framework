# Tool-First Skill Orchestration

Status: draft-v1
Related tasks: `TASK-SKL-0005`, `TASK-SKL-0008`, `TASK-SKL-0010`

This document defines the tool-first migration contract for ATM skills. It
keeps entry skills short while making the preferred execution order explicit
for tool-capable editors, legacy CLI environments, and future Team role packs.

## Core Rule

When an environment exposes a structured ATM tool or connector, an ATM skill
should use that tool before reaching for an ad hoc shell command. The tool
result is route truth: if it returns a blocked status, warning, next action,
playbook, allowed command, or blocked command, the skill must surface that
result instead of silently bypassing it with a manual workaround.

CLI fallback remains valid when:

- no structured tool or connector is available;
- the task is read-only inspection and the CLI is the official inspection
  surface;
- the tool result explicitly names a CLI fallback in `allowedCommands` or
  `evidence.nextAction.command`;
- the user explicitly asks for the CLI fallback; or
- a legacy editor cannot expose the tool surface yet.

Fallback must preserve the same governance route. It cannot become a second
task model, approval workflow, registry, or hidden shell habit.

## Capability Ladder

Use this ladder from strongest to weakest:

1. Structured ATM tool or editor connector that returns the CLI result contract.
2. Official ATM CLI command returned by the tool or skill, usually
   `node atm.mjs next --prompt "<current user prompt>" --json` or the command
   named in `evidence.nextAction.command`.
3. Read-only shell inspection for files, logs, or local context.

Do not skip from step 1 to step 3 just because a blocked tool result is
inconvenient. A blocked result is still useful governance evidence.

## Router, Playbook, Specialist Split

The entry router should stay thin:

- `atm-governance-router` decides whether the request belongs in ATM and
  starts the official route.
- `atm-task-intent-resolver` owns semantic task-intent clarification when the
  request names task cards, plans, or batches.
- `evidence.nextAction.playbook` owns the per-route work order after `next` or
  `next --claim`.
- Specialist skills such as `atm-next`, `atm-evidence`, `atm-lock`,
  `atm-dispatch`, and future Team role packs own scoped follow-up behavior.

The router should not absorb role-specific execution logic. If a Team role
needs to participate, the playbook should select the role pack and issue a
scoped lease instead of making the router a permanent role bundle.

## Blocked Result Handling

When a structured tool or CLI result blocks:

1. Surface the status code, reason, and any `ATM_USER_NOTICE` or
   `evidence.userNotice`.
2. Preserve `allowedCommands`, `blockedCommands`, and
   `evidence.nextAction.command` when present.
3. Continue only through a listed fallback or a task playbook instruction.
4. Record the mismatch as a skill learning item when the fallback was unclear.

The fallback lesson belongs in the relevant `references/*` shard first. Promote
only the durable rule into `SKILL.md`.

## Team Broker Vocabulary Seam

Team Broker and Team Agent lanes must preserve these shared fields when they
appear in tool, CLI, artifact, or evidence output:

- `decisionClass`
- `decisionReason`
- `violationStatus`
- `broker-conflict-blocked`

Role packs may interpret these fields, but they must not rename or discard
them. Preserving the shared vocabulary lets broker conflict resolution, gate
parity, conflict UX, and replay benchmarks compose without merging their
planning cards or creating a second conflict model.

## Acceptance Checklist

A skill migration satisfies this contract when:

- tool-capable environments are told to use structured tools before shell;
- blocked tool results are surfaced as route truth;
- CLI fallback remains explicit and governed;
- `atm-governance-router` delegates to playbooks and specialist skills instead
  of becoming a large all-in-one skill; and
- future Team role packs can compose through the same tool/result vocabulary.
