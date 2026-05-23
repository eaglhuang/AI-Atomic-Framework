---
applyTo: "**"
---

# ATM Task Intent Resolver

Use this instruction when the user mentions a task id, task card, plan document,
or scoped task batch.

First run:

```bash
node atm.mjs next --prompt "<current user prompt>" --json
```

If ATM returns `ATM_NEXT_TASK_SELECTION_REQUIRED`, ask for a task id or narrower
plan scope. If ATM returns a `requiredCommand`, run that command before editing.

Do not edit task cards, claim tasks, or close tasks from this instruction. ATM
CLI is the authority for all routing decisions.
