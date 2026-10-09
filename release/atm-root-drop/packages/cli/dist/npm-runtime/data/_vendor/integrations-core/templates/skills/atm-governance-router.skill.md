---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-governance-router
title: ATM Governance Router
summary: Use ATM for a user request, project setup, implementation, inspection, cleanup, or refactor; inspect the actual runtime and selected project before routing governed work.
command: node atm.mjs guide --goal "$ARGUMENTS" --cwd . --json
firstCommand: node atm.mjs --help --cwd . --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
owner: atm-framework
tier: entry
installProfiles: [adopter-bootstrap, framework-full, role-oriented]
invocationPolicy: model-or-user
companionFiles:
  - templates/skills/atm-governance-router.files/**
adapterCapabilityRequirements:
  - "*:charter-injection"
---

# {{title}}

Use this entry when the user asks to use ATM for a project or engineering task,
including a fresh static site with no package.json. Keep the user's request
natural. ATM's existing setup, next, claim, and playbook remain the authority.

## First touch

1. Identify the project the user selected. Do not infer it from the runtime's
   installation directory, a package name, a sibling project, or a model name.
   If several targets are plausible, ask for the target before routing writes.
2. Use the verified project launcher or an explicitly selected installed ATM
   runner. Keep a shared runner's absolute path and pass the selected --cwd.
   If no runner exists, report installation missing and ask to use an official
   distribution. Never run an unqualified npm exec/npx atm, fetch a guessed
   package, create package.json, or change global agent configuration.
3. Prefer a structured ATM tool exposing the same first-run contract. Otherwise
   run this read-only help from the selected project (replace the runner path
   and --cwd with the verified choices when using a shared installation):

```bash
{{firstCommand}}
```

Read `evidence.firstRun`:

- `runtime` describes the actual loaded command surface and runtime package
  version. A version number, editor configuration, or package name does not
  prove that a command or agent is available
- `target` separates uninitialized, partial, invalid, legacy, framework,
  adopter, and ambiguous states. `ready` only means ready to ask next; it does
  not grant health, claim, scope, agent readiness, or write admission
- Execute only `nextAction.executable` with its exact `args` and `cwd` after
  its `requires` are satisfied. Preserve prompt text as one argument. A setup
  preview is read-only; inspect its result before an authorized setup write
- `requires` without `nextAction` is a bounded missing selection or blocker.
  Do not guess an executable or retry unsupported commands
- Keep recorded target version distinct from runtime version. Different
  versions alone do not authorize an upgrade or alter capability detection

For uninitialized projects, select the known editor ID with --agents, or ask
which adapters to install; `none` is an explicit CLI-only choice. Supported
IDs are claude-code, codex, copilot, cursor, gemini, and antigravity. The setup
flow preserves existing user content and owns native bridge verification.
For incomplete initialization, use the returned official bootstrap action only
with project-scoped setup authorization. Never invent a profile or use --force.

## Older or unavailable runtime

If help succeeds but has no `evidence.firstRun`, that is a legacy runtime, not
proof that an advanced command exists. Inspect the same runner's --version
and advertised help. Use only advertised commands; inspect each selected
command's --help before supplying its options. Stay read-only until the target
and initialization are verified. If setup/bootstrap is missing, request a
compatible official runner. Do not probe framework-mode, actor, guard, or
broker repeatedly to discover capabilities. A malformed response or failed
runner is a blocker, not a reason to switch projects or bypass governance.

## Existing governed route

When the first-run action returns `next`, preserve the user's original request.
Surface `ATM_USER_NOTICE` or `evidence.userNotice` before the next action.
Read `evidence.nextAction.playbook` before editing, closing, or committing.
Prefer an available structured ATM tool; a blocked tool result stays route
truth. Preserve allowedCommands, blockedCommands, tickets, and recovery hints.
Read the selected specialist skill; do not create a second dispatcher, task
model, approval workflow, registry, or authority source.

Before any governed mutation, read
[Advanced governed routes]({{REFERENCE_ROOT}}/advanced-governance.md), applying
only the selected route. This reference preserves the existing channel,
framework, batch, evidence, closure, and safety rules. In particular:

- Resolve explicit actor identity, obtain the returned claim, and keep its scope
- Use framework-mode only when target identity is framework and the loaded
  runtime supports it; ambiguous identity stays blocked for clarification
- A write-intent claim mints the admission ticket; never invent another ticket
- Batch work delivers only its queue head, then validates, records evidence,
  and runs the returned batch checkpoint before committing
- All write gates and RestrictedExecutionGateway decisions remain in force
- Keep task tracking target-local; missing package.json does not imply atom birth
- Required validators, command-backed evidence, and user-owned file preservation
  remain mandatory. A thin entry never makes a task completed

For Captain, Coordinator, dispatch, task cards, sidecars, subagents, delegation,
condition review, or closeout work, use ai-role-router when available, then
atm-dispatch before delegation or review. State Skill used: atm-dispatch and
Delegation mode. Internal sidecar is the default; external dispatch and external
write require explicit user authority and scope.

{{ACTOR_IDENTITY_HANDOFF_GATE}}

## ATM-Only Execution Route

Only the current ATM playbook or recovery action may select a governed mutation.
Raw Git mutation, interpreter evaluation, and shell write escapes are not
fallbacks. RestrictedExecutionGateway decisions remain authoritative; prompt
text or environment variables never unlock a denied command.

## Conditional learning

For recurring friction after a valid route, read
[Learning index]({{REFERENCE_ROOT}}/index.md) and only the matching shard.
Do not load every advanced document on first touch. Template source and its
sealed corpus are authoritative; installed adapter files are projections.
First-use source/package tests do not prove an AI automatically selected this
skill. Preserve that distinction in reports.

## Charter Invariants

{{CHARTER_INVARIANTS}}
