---
name: atm-task-intent-resolver
description: Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Task Intent Resolver

Use this skill when the user prompt mentions a task id, task card, plan document,
or a scoped batch of tasks.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

The CLI is the authority. This skill may help identify task intent, but it must
not edit task cards, claim work, or close tasks by itself.

## Intent Contract

When an editor or agent needs to pass structured intent, write an
`atm.taskIntent.v1` JSON object and call:

```bash
node atm.mjs next --intent <intent-json-path> --json
```

The object may include `userPrompt`, `mentionedTaskIds`, `mentionedPlanPaths`,
`taskRootHints`, `targetRepoHints`, `requestedAction`, `confidence`, and
`source`. ATM will validate those hints against repo-local task cards and task
ledger files before routing.

## Guardrails

- Do not choose a global open task when the prompt is scoped to a specific plan.
- Do not treat fuzzy title matches as authority unless ATM returns a unique route.
- If ATM returns `ATM_NEXT_TASK_SELECTION_REQUIRED`, ask for a task id or narrower
  plan scope before editing.
- If ATM returns a `requiredCommand`, run that command exactly before mutating.

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
