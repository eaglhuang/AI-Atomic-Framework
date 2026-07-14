---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-orient
title: ATM Orient
summary: Inspect a repository and emit a guidance orientation report.
command: node atm.mjs orient --cwd . --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
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

## Memory Read Step (TASK-MEM-0004)

Before acting in an unfamiliar repo, locate its keep entry point and memory
directory via the keep registry (in the coordinating workspace:
`docs/keep.registry.md`), then read the keep summary's memory index section
and pull only the memory notes relevant to the planned work. Cold-starting
without reading recorded gotchas repeats already-solved failures. Treat aged
notes as point-in-time observations: verify before asserting.

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
