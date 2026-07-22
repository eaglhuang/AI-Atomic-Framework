---
applyTo: "**"
---


# ATM Atom Map Refactor

Use this skill before editing ATM framework code for a refactor, extraction,
governance-invariant cleanup — and for ANY task card whose scope touches a
large governance module (over 600 lines), not only cards labeled as refactors
(TASK-AAO-FABLE-006). The goal is to choose a small atom owner and a testable
contract before moving code.

Extraction-first is a core ATM intent: prefer proposing the change as a new
atom or atom map over inline-editing the large module. The owner/pattern
selection below IS the extraction proposal — record it in the card's
`atomizationImpact.extractionCandidates` (see the `atm-task-card-authoring`
skill) and restate it in the implementing agent's dispatch report. Staying
inline is a human decision and requires a recorded `inlineReason` on the
card. ATM patrols this at import time via the advisory diagnostic
`ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE`.

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

If the task is not a refactor or extraction task, still run steps 2-4 to
produce an extraction candidate whenever the touched module exceeds 600 lines,
then record it as `extract`, `follow-up-card`, or human-approved `inline` on
the card. Do not turn an unrelated bug fix into a broad cleanup — propose,
let the Captain/human decide, and default to opening the follow-up card.

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

Read `references/casebook.md` when the current task resembles prior CID work or
when adding a new lesson after a successful extraction.

Add a new case only after a task is governed done. Keep cases short: problem,
chosen pattern, owner module, proof, lesson.

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
- `INV-ATM-008` ??**Broker tickets, not refusals** (enforcement: `doctor`, breaking change: no)
  Rule: Every governed shared-write gate (runner-sync, build windows, release mirrors, git commit, projection regeneration) must respond with a broker ticket - execute now, enqueue with position, or batch into a shared write window - never a bare refusal. Reads and private writes (own ledger, evidence, task events, lane sessions) never queue. The only standing exceptions are the four owner-ruled cases in docs/governance/parallel-governance-charter.md; any new serialization point requires an explicit project-owner ruling before it ships.
- `INV-ATM-009` ??**Generalized repair and data-driven policy** (enforcement: `doctor`, breaking change: no)
  Rule: Any code logic change, bug fix, or governance rule change must first be designed as the most general rule that correctly explains the observed failure class. Hard-coded special cases are allowed only with recorded evidence that the general rule is not currently safe, feasible, or economical, and that the exception is bounded and reversible. Data-shaped behavior, including thresholds, mappings, allowlists, routing choices, telemetry classifications, prompts, message text, fixtures, and domain content, must first be modeled outside control flow through schemas, registries, configuration, observed counters, or compact digest evidence instead of embedded changeable numbers or strings. The generalized solution must remain observable, testable, and no broader than the evidence supports.
- `INV-ATM-010` ??**Single canonical worktree and compose-first shared writes** (enforcement: `doctor`, breaking change: no)
  Rule: Normal governed parallel development uses one canonical worktree, base, and HEAD. A shared physical file is compose-eligible rather than a file lock: workers declare bounded atom/CID/content-anchor/source-range intents and submit proposals, while the broker, format adapter, and transactional composer decide compose, revalidation, escalation, or queue. A neutral steward is the only shared-file writer and shared delivery records member attribution. Queueing or revalidation is a fallback for a true logical conflict, stale base/CAS failure, unsupported adapter, or fairness bound. AI workers must not use Git branches, detached worktrees, alternate indexes, merges, or rebases as normal concurrency/isolation mechanisms. The closed exceptions are emergency/anomaly recovery, historical read-only discrimination, and non-development sealed packaging; each requires a named receipt and cannot perform normal governed contribution writes.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
