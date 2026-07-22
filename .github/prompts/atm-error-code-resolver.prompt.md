---
mode: agent
description: Resolve ATM_* error codes from CLI JSON, logs, or user reports into canonical meaning, remediation, retryability, and approval guidance.
---


# ATM Error Code Resolver

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

Do not introduce a second registry, task state, or approval path.
