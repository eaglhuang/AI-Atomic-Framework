---
applyTo: "**"
---


# ATM Evidence

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
node atm.mjs explain --why blocked --json
```

If blocked guidance includes an `ATM_*` code, use `atm-error-code-resolver`
for the meaning, retryability, approval requirement, and next safe action. Do
not turn source-index context into a private remediation table here.

## Governance Evidence Checklist

When explaining readiness or missing evidence for a governed task, check for:

- consumed sealed summaries;
- missing data and assumption changes;
- a stop rule;
- touched shared-write gates and the `INV-ATM-008` outcome;
- telemetry window, watermark, counters, duration/timing, source availability,
  compact digest, and explicit unavailable receipts;
- frozen-entry smoke evidence when runner, release, broker shared-write
  behavior, first-layer entry behavior, skill template projection, or generated
  integration output changed.

If a required signal is unavailable, say `unavailable` with the receipt or
reason. Do not treat missing telemetry as zero latency, zero failures, or
success.

## Team Agents Evidence Surface

When evidence or blocked guidance involves Team Agents, recognize these as
first-class proof surfaces:

- `atm.teamProviderRunArtifact.v1` proves a governed provider role run.
- `atm.reviewAgentSignature.v1` proves formal or advisory Review Agent output.
- `atm.teamAgentObservabilityEvent.v1` proves runtime events such as
  `artifact.output`, `session.failure`, and `broker.conflict.blocked`.
- `knowledge.query` is shareable advisory read access; `knowledge.index.write`
  is coordinator-only generated cache writing.
- `review.signature.write` is formal Review Agent authority and requires the
  independence/quorum checks named by the task.

If `decisionClass`, `decisionReason`, `requiresHumanSignoff`, `requiresAdr`,
`violationStatus`, or `escalationTarget` appears in plan/status/start output,
carry those fields into the evidence explanation. If `violationStatus` is
`broker-conflict-blocked`, explain the required Broker resolution path instead
of treating it as a warning.

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

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

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
