# AtomicCharter — [PROJECT_NAME]

> **Framework authority level.** The rules in this charter are enforced by ATM at the
> framework layer. Host project rules and profiles are secondary. Conflicts must be
> resolved through a governed charter waiver proposal (`behavior.evolve` +
> `charterWaiver` + `HumanReviewDecision`), not by silent override.

**Charter version**: [CHARTER_VERSION]  
**Last amended**: [LAST_AMENDED_DATE]  
**Machine-readable invariants**: `.atm/charter/charter-invariants.json`

---

## 1. Authority Hierarchy

```
AtomicCharter (this file)           ← highest authority
    ↑ conflicts require waiver flow
host project rules / profiles       ← secondary
    ↑ extends
single-agent / single-user overlays ← lowest
```

ATM enforces this hierarchy through `atm doctor` (`charter-integrity` check),
`atm upgrade --propose` (invariant gate), and `atm guard charter --files <...>`.

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
1. Edit this file and `charter-invariants.json` together.
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
