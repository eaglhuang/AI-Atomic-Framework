---
name: atm-error-code-resolver
description: Resolve ATM_* error codes from CLI JSON, logs, or user reports into canonical meaning, remediation, retryability, and approval guidance.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Error Code Resolver

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

- `INV-ATM-001` ??**No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` ??**Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` ??**Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` ??**No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` ??**Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` ??**Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` ??**Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.
