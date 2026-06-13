---
name: atm-atom-map-refactor
description: Plan ATM framework refactors by preserving atom/map semantics before splitting large governance modules.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Atom Map Refactor

Use this skill before editing ATM framework code for a refactor, extraction, or
governance-invariant cleanup. The goal is to choose a small atom owner and a
testable contract before moving code.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Required Workflow

1. Read the active task card and its allowed files.
2. Name the governance invariant being touched.
3. Choose exactly one primary extraction pattern:
   - Policy Object
   - Strategy Map
   - Result Contract Object
   - Facade
   - Adapter/Port
4. Propose the owner module, public surface impact, focused test, and CLI
   regression.
5. Extract only the atom already in task scope.
6. Record adjacent refactors as follow-up work instead of widening the task.

If the task is not a refactor or extraction task, use this skill only to
identify a future atom candidate. Do not turn an unrelated bug fix into a broad
cleanup.

## Pattern Selection

Read `references/patterns.md` when choosing the extraction shape or reviewing a
proposed split.

Use the short rule:

- Admission, permission, waiver, or allowed/blocked decisions -> Policy Object.
- Mode, bucket, or route selection -> Strategy Map.
- Evidence, diagnostics, bundle, or provenance output -> Result Contract
  Object.
- Operator-facing command that delegates to atoms -> Facade.
- Host/adopter boundary -> Adapter/Port.

## ATM Guardrails

- Keep `taskflow open` and `taskflow close` as normal operator lanes.
- Treat direct `tasks close`, `tasks reconcile`, `tasks import --write --force`,
  and `tasks repair-closure` as backend/emergency surfaces when used directly.
- Keep caller-facing contracts stable. Prefer re-exporting from
  `public-surface.ts` instead of changing callers ad hoc.
- Do not create a second task lifecycle, task storage model, registry, or close
  authority.
- Keep source delivery commits separate from runner-sync commits when
  `ATM_RUNNER_SYNC_REQUIRED` appears.
- Add focused tests for the extracted atom, then run the task card validators.

## Output Shape

Before implementing a refactor, produce a concise plan:

```text
Atom:
Pattern:
Owner module:
Callers:
Public surface:
Focused test:
CLI regression:
Out of scope:
Commit split:
```

If the implementation proceeds, report the same fields with the final paths and
validator results.

## Casebook

Read `references/casebook.md` when the current task resembles prior CID or RFT
work or when adding a new lesson after a successful extraction.

The casebook covers two refactor series:

- **CID series** (`TASK-CID-005x`..`TASK-CID-007x`) — closeout/governance-invariant
  atomization, targeting `packages/cli/src/commands/tasks.ts`. See the plan at
  `docs/ai_atomic_framework/cid-hardening/atm-tasks-command-atomic-map-refactor-plan.md`
  in the planning repo.
- **RFT series** (`TASK-RFT-0001`..`TASK-RFT-0008`) — size/complexity atomization,
  targeting the other oversized governance-critical modules (`next.ts`,
  `hook.ts`, `framework-development.ts`, `validate-task-ledger-governance.ts`,
  `captain-dispatch-mailbox.ts`, `police/family.ts`, `evidence.ts`, `taskflow.ts`).
  See the plan at
  `docs/ai_atomic_framework/rft-hardening/atm-cli-oversized-module-refactor-plan.md`
  in the planning repo.

If your current task matches an RFT forward case, read the case before
implementing — the suggested owner modules, focused tests, and line-count
ceilings are already pre-decided so you do not have to re-derive them.

Add a new case only after a task is governed done. Keep cases short: problem,
chosen pattern, owner module, proof, lesson.

- `INV-ATM-001` — **No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` — **Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` — **Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` — **No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` — **Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` — **Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` — **Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.
