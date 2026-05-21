# ATM Copilot Instructions

First command:

```bash
node atm.mjs next --json
```

## Charter Invariants

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

## Entry Skills

- atm-next: Recommend the next official ATM guidance action from current state.
- atm-orient: Inspect a repository and emit a guidance orientation report.
- atm-governance-router: Route natural-language cleanup, refactor, migration, and candidate ranking goals through ATM before local analysis.
- atm-create: Create and register an atom through the provisioning facade.
- atm-lock: Check, acquire, or release a governed scope lock.
- atm-evidence: Explain missing evidence or blocked guidance before proceeding.
- atm-upgrade-scan: Scan evidence reports and draft governed upgrade proposals.
- atm-handoff: Write a continuation summary for governed work.
- atm-internal-build-sync: Build the ATM framework runner and sync it to explicit internal adopter repositories with skip/exclude controls.

## Operating Rules

- Route governed work through ATM before editing files.
- Run `node atm.mjs framework-mode status --json` before implementation edits; if it reports `required` or `cross-repo-target-required`, use the framework-development guard and target-repo closure evidence.
- Use the ATM prompt and instruction files for specific next, orient, governance-router, create, lock, evidence, upgrade-scan, and handoff flows.
- Do not hand-edit task status to `done`, bulk-close task cards, or treat static `atomic_workbench/evidence/*.json` files as completion evidence.
- Do not create a parallel task model, registry, or approval workflow.
