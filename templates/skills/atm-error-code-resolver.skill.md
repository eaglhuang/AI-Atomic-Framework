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

Use this skill when a user, CLI result, validator output, hook, plan, or task
card mentions an `ATM_*` code and needs interpretation, recovery guidance,
registration, renaming, or retirement.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Lookup Order

1. Extract exact `ATM_*` codes from the user text or CLI JSON.
2. Read `docs/governance/error-code-registry.json` first.
3. If a code has an exact registry entry, answer from that entry.
4. If no exact entry exists, look for the longest matching `prefixRules[]`
   entry in the same registry and report the code as `prefix-documented`.
5. If neither an exact entry nor a prefix rule covers the code, read
   `docs/ERROR_CODES.md` to find source location/context, then say the code is
   `registry-missing`.
5. Do not invent recovery authority. If the registry says human approval is
   required, state that before any retry command.

## Output Contract

For each code, report:

- `meaning`: one short operator-facing sentence.
- `category`: exact or prefix registry category, or `unknown` when
  registry-missing.
- `retryable`: `yes`, `no`, or `unknown`.
- `human approval`: `yes`, `no`, or `unknown`.
- `next safe action`: the smallest command or inspection step.
- `source`: exact registry sourceOwner, prefix rule sourceOwner, or source-index
  location.

If the code is `registry-missing`, add this remediation:

```bash
npm run generate:error-codes
```

Then open or update a governed task/backlog item to add the missing entry in
`docs/governance/error-code-registry.json`.

## Authoring And Registration Flow

Use this flow before a plan, task card, or implementation introduces, renames,
or retires an `ATM_*` code:

1. Classify the condition. Normal states such as `paused`, `deferred`,
   `inconclusive`, cache miss, or successful broker enqueue are not errors.
   Create an ErrorCode only for a command failure or an operator-actionable
   guarded boundary that needs stable retry, approval, or recovery semantics.
2. Search the exact entries and `prefixRules[]` in
   `docs/governance/error-code-registry.json`. Reuse an existing exact code only
   when its trigger and recovery semantics match; a prefix rule documents a new
   code but does not reserve its exact meaning.
3. Record every planned code in the source plan and owning task card with:
   `code`, `disposition` (`reuse`, `register`, `rename`, or `retire`), trigger,
   category, retryability, human-approval requirement, recovery command, source
   owner, registry-owner task, and required tests.
4. When parallel cards would otherwise contend on the single registry file,
   assign one foundational registry-owner task to register the plan-wide code
   catalog. Other cards keep their own code contract but must not independently
   edit the shared registry.
5. The registry-owner delivery updates
   `docs/governance/error-code-registry.json`, runs
   `npm run generate:error-codes`, and commits the generated
   `docs/ERROR_CODES.md`. Do not hand-edit the generated file.
6. The implementation that emits a code must include structured details and a
   focused test proving the exact trigger, exit behavior, retry/approval
   contract, and recovery guidance. A planned code is not complete merely
   because it appears in prose or the registry.
7. Renames and retirements must preserve an explicit compatibility or migration
   path. Never silently reuse an old code name for a different meaning.

If a plan discovers a new ErrorCode after its catalog was sealed, amend the
plan and owning card through this skill before implementing the emitter.

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
