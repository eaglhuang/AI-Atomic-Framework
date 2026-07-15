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

When a handoff mentions unresolved `ATM_*` codes, point the next agent to
`atm-error-code-resolver` instead of copying ad hoc recovery prose. Include the
code, command that produced it, and whether the registry entry was found.

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

## Memory Write Check (TASK-MEM-0004)

Before finishing a handoff summary, answer this checklist explicitly (write
"none" when empty):

1. Confirmed pitfall + fix this session? -> write a `gotcha` memory note.
2. Major closure snapshot (lane cleared, milestone done)? -> write a `status` note.
3. Human corrected the working method? -> write a `feedback` note with Why /
   How to apply.
4. An existing memory note proven wrong? -> update or retire it now.

Write into the current repo's keep-memory directory (resolve via the keep
registry; in the coordinating workspace this is `docs/keep-memory/` with the
contract in its README). Do NOT write: anything already recorded in backlog,
task cards, or consensus shards; details only meaningful to this session.
Governance defects go to the ATM bug backlog first — memory notes carry only
the operator intuition the formal record does not keep.

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
