# AtomicCharter — ai-atomic-framework

> **Framework authority level.** The rules in this charter are enforced by ATM at the
> framework layer. Host project rules and profiles are secondary. Conflicts must be
> resolved through a governed charter waiver proposal (`behavior.evolve` +
> `charterWaiver` + `HumanReviewDecision`), not by silent override.

**Charter version**: 2.2.0
**Last amended**: 2026-07-17T00:00:00.000Z
**Machine-readable invariants**: `.atm/charter/charter-invariants.json`
**Normative design schedule**: `.atm/charter/atm-first-principles.md` (version 1.0.0)
**Schedule SHA-256**: `sha256:488d193397ed56b89f6f526aa882ebcb4fd8e9f81d2c4a5c8b30e5a3d5487f5c`

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
