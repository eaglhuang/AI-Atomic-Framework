---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-next
title: ATM Next
summary: Recommend the next official ATM guidance action from current state.
command: node atm.mjs next --json
firstCommand: node atm.mjs next --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

First command:

```bash
{{firstCommand}}
```

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
{{command}}
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
- If `evidence.userNotice` is present, briefly show it to the user in natural language before continuing.
