---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-error-code-resolver
title: ATM Error Code Resolver
summary: Resolve ATM_* error codes from CLI JSON, logs, or user reports into canonical meaning, remediation, retryability, and approval guidance.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when a user, CLI result, validator output, hook, or task report
mentions an `ATM_*` code and needs interpretation or recovery guidance.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Lookup Order

1. Extract exact `ATM_*` codes from the user text or CLI JSON.
2. Read `docs/governance/error-code-registry.json` first.
3. If a code is registered, answer from that registry entry.
4. If a code is missing from the registry, read `docs/ERROR_CODES.md` to find
   source location/context, then say the code is `registry-missing`.
5. Do not invent recovery authority. If the registry says human approval is
   required, state that before any retry command.

## Output Contract

For each code, report:

- `meaning`: one short operator-facing sentence.
- `category`: registry category, or `unknown` when registry-missing.
- `retryable`: `yes`, `no`, or `unknown`.
- `human approval`: `yes`, `no`, or `unknown`.
- `next safe action`: the smallest command or inspection step.
- `source`: registry sourceOwner or source-index location.

If the code is `registry-missing`, add this remediation:

```bash
npm run generate:error-codes
```

Then open or update a governed task/backlog item to add the missing entry in
`docs/governance/error-code-registry.json`.

## Shared-Skill Rule

Other ATM skills should route error-code interpretation through this resolver
instead of maintaining private error-code tables. They may summarize the result,
but the registry remains the source of truth.

## Guardrails

- Do not treat source index context as a full remediation plan.
- Do not bypass ATM lifecycle, Team Broker, approval, or git-governance lanes.
- Do not hand-edit `docs/ERROR_CODES.md`; update the registry or generator and
  regenerate it.

## Charter Invariants

{{CHARTER_INVARIANTS}}
