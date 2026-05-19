---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-lock
title: ATM Lock
summary: Check, acquire, or release a governed scope lock.
command: node atm.mjs lock check --json
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

Mutation safety checks should use ATM guard commands:

```bash
node atm.mjs guard mutation --task <task-id> --actor "$ATM_ACTOR_ID" --files <csv> --json
node atm.mjs guard git --task <task-id> --actor "$ATM_ACTOR_ID" --json
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
