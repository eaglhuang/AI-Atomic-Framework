---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-task-intent-resolver
title: ATM Task Intent Resolver
summary: Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when the user prompt mentions a task id, task card, plan document,
or a scoped batch of tasks.

## First Command

```bash
{{firstCommand}}
```

The CLI is the authority. This skill may help identify task intent, but it must
not edit task cards, claim work, or close tasks by itself.

## Intent Contract

When an editor or agent needs to pass structured intent, write an
`atm.taskIntent.v1` JSON object and call:

```bash
node atm.mjs next --intent <intent-json-path> --json
```

The object may include `userPrompt`, `mentionedTaskIds`, `mentionedPlanPaths`,
`taskRootHints`, `targetRepoHints`, `requestedAction`, `confidence`, and
`source`. ATM will validate those hints against repo-local task cards and task
ledger files before routing.

## Guardrails

- Do not choose a global open task when the prompt is scoped to a specific plan.
- Do not treat fuzzy title matches as authority unless ATM returns a unique route.
- If ATM returns `ATM_NEXT_TASK_SELECTION_REQUIRED`, ask for a task id or narrower
  plan scope before editing.
- If ATM returns a `requiredCommand`, run that command exactly before mutating.

## Charter Invariants

{{CHARTER_INVARIANTS}}
