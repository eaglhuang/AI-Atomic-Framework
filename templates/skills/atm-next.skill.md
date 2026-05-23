---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-next
title: ATM Next
summary: Recommend the next official ATM guidance action from current state.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

If the current user prompt mentions a task id, task card, plan document, or a
scoped batch of tasks, invoke the `atm-task-intent-resolver` skill first. That
skill must write `.atm/runtime/task-intent.json` and route with:

```bash
node atm.mjs next --intent .atm/runtime/task-intent.json --json
```

Use the prompt-scoped command below only when no task or plan scope is present or
when the editor cannot run the semantic intent skill.

First command:

```bash
{{firstCommand}}
```

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
{{command}}
```

For collaboration workflows, claim the selected imported task before edits:

```bash
node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --prompt "$ARGUMENTS" --json
```

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
- If an `ATM_USER_NOTICE` message or `evidence.userNotice` is present, show it to the user in natural language before executing the returned next action.
- After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.
- Treat `ATM_ACTOR_ID` as the default actor identity variable. `AGENT_IDENTITY`
  is legacy-compatible only.
