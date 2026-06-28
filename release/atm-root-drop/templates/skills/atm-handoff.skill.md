---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-handoff
title: ATM Handoff
summary: Write a continuation summary for governed work.
command: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

{{ACTOR_IDENTITY_HANDOFF_GATE}}

Handoff transfers context, evidence, blockers, and next recommended commands. It
does not transfer actor authority. The receiving agent must clear stale default
identity when needed and claim with its own explicit actor id before editing,
closing, reporting, or committing.

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
