---
name: atm-task-intent-resolver
description: Resolve the current user prompt into ATM task scope before running next-action routing.
argument-hint: "<current user prompt>"
charter-invariants-injected: true
---

# ATM Task Intent Resolver

Use this skill when the user mentions a task id, task card, plan document, or
scoped task batch.

First run:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

If ATM returns `ATM_NEXT_TASK_SELECTION_REQUIRED`, ask for a task id or narrower
plan scope. If ATM returns a `requiredCommand`, run that command before editing.

Do not edit task cards, claim tasks, or close tasks from this skill. ATM CLI is
the authority for all routing decisions.
