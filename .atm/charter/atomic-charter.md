# AtomicCharter — ai-atomic-framework

> **Framework authority level.** The rules in this charter are enforced by ATM at the
> framework layer. Host project rules and profiles are secondary. Conflicts must be
> resolved through a governed charter waiver proposal (`behavior.evolve` +
> `charterWaiver` + `HumanReviewDecision`), not by silent override.

**Charter version**: 2.4.0
**Last amended**: 2026-07-22T03:10:00.000Z
**Machine-readable invariants**: `.atm/charter/charter-invariants.json`
**Normative design schedule**: `.atm/charter/atm-first-principles.md` (version 1.0.0)
**Schedule SHA-256**: `sha256:4936539324d5c04a3275eda735a75f9af6bf8bdce83cb5584420fdf43d33f7e2`

---

## 1. Authority Hierarchy

```
AtomicCharter (this file)              <- sole constitutional authority
    | incorporates and constrains
ATM First Principles (Schedule A)      <- highest design and acceptance guidance
    | conflicts require Charter change or waiver
host project rules / profiles          <- secondary
    | extends
single-agent / single-user overlays    <- lowest
```

The ATM First Principles schedule is normative because this Charter incorporates
it. The schedule operationalizes governance design, efficiency, evidence, and
delivery acceptance. It cannot add, remove, waive, or override a Charter
invariant. If the schedule and this Charter conflict, this Charter prevails and
the conflict fails closed until resolved through the Charter amendment process.

ATM's required enforcement surfaces are `atm doctor` (`charter-integrity`),
`atm upgrade --propose` (invariant gate), and
`atm guard charter --files <...>`. Machine coverage that is not yet connected must
be reported as an implementation gap and must not be represented as enforced.

---

## 2. Framework Invariants

The following invariants are immutable unless a charter waiver proposal is approved.
See `charter-invariants.json` for the machine-readable form used by ATM guards.

| ID | Title | Enforcement |
|----|-------|-------------|
| INV-ATM-001 | No second registry | gate |
| INV-ATM-002 | Lock before edit | doctor |
| INV-ATM-003 | Schema-validated promotion only | gate |
| INV-ATM-004 | No competing highest authority | doctor |
| INV-ATM-005 | Host rule amendments require waiver flow | waiver-required |
| INV-ATM-006 | Framework work tracking stays target-local | doctor |
| INV-ATM-007 | Public framework docs remain English-only | doctor |
| INV-ATM-008 | Broker tickets, not refusals | doctor |
| INV-ATM-009 | Generalized repair and data-driven policy | doctor |
| INV-ATM-010 | Single canonical worktree and compose-first shared writes | doctor |

### INV-ATM-008 — Broker tickets, not refusals (parallel governance principle)

ATM has no concept of "refusal" at shared-write gates. Every governed Tier-2
(shared write) surface — runner-sync, build windows, release mirrors, git
commit, projection regeneration — must answer with a broker ticket: execute
now, enqueue with a position, or batch into a shared write window. Reads and
private writes (an agent's own ledger, evidence, and task events) never queue.
The only standing exceptions are the four owner-ruled cases recorded in
`docs/governance/parallel-governance-charter.md`. Any new serialization point
an implementer wants to introduce must be surfaced to the project owner for an
explicit ruling before it ships.

### INV-ATM-009 — Generalized repair and data-driven policy

Any code logic change, bug fix, or governance rule change must first be designed
as the most general rule that correctly explains the observed failure class. A
hard-coded special case is allowed only when the implementer records why the
general rule is not currently safe, feasible, or economical, and leaves evidence
that the exception is bounded and reversible.

When the failure or behavior is data-shaped — including thresholds, mappings,
allowlists, routing choices, telemetry classifications, prompts, message text,
fixtures, and domain content — the first design option must separate data from
logic. Prefer schemas, registries, configuration, observed counters, or compact
digest evidence over embedding changeable numbers or strings in control flow.
The rule is not a license for speculative abstraction: the generalized solution
must be observable, testable, and no broader than the evidence supports.

### INV-ATM-010 — Single canonical worktree and compose-first shared writes

Normal governed parallel development uses one canonical worktree, base, and
HEAD. A shared physical file is not a file lock: workers declare bounded
atom/CID/content-anchor/source-range intents and produce proposals; the broker,
format adapter, and transactional composer decide whether proposals can compose.
When they can, a neutral steward is the only writer that applies the composed
result to the canonical worktree and the shared-delivery adapter records member
attribution in one delivery.

Queueing or revalidation is a fallback for a true logical conflict, stale
base/CAS failure, unsupported adapter, or fairness bound. An AI worker must not
use a Git branch, detached worktree, alternate index, merge, or rebase as a
normal concurrency or isolation mechanism. Git remains an outer delivery
substrate after steward apply. The closed exceptions are emergency/anomaly
recovery, historical read-only discrimination, and non-development sealed
packaging; each exception requires a named receipt and cannot perform normal
governed contribution writes.

---

## 3. Agent Entry Point

Every AI agent operating in this repository must begin with:

```bash
node atm.mjs next --json
```

This produces a `nextAction` that routes the agent to the correct governed step
before any file edits. Skipping this step is detectable by `atm doctor` through
the `lock-before-edit` guard and `git-head-evidence` check.

---

## 4. Amending This Charter

Amendments that do not touch an invariant:
1. Edit this file and `charter-invariants.json` together. If the amendment changes
   an incorporated schedule, update that schedule in the same change.
2. Update `charterVersion` (minor bump) and `lastAmendedAt`.
3. Commit with ATM evidence (`atm handoff summarize`).

Amendments that change or remove an invariant (breaking change):
1. Open an `UpgradeProposal` with `behaviorId: "behavior.evolve"`.
2. Add a `charterWaiver` block referencing the invariant ID.
3. Obtain a `HumanReviewDecision` before promotion.
4. Bump `charterVersion` major.

---

## 5. Scope

This charter applies to all agents, human contributors, and automated tooling
operating in this repository. It does not apply to downstream consumers of
published artifacts.
