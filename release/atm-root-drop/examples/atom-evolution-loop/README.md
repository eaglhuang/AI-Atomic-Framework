# Atom Evolution Loop Example

This example demonstrates the **ATM Atom Evolution Loop** — the full lifecycle from evidence collection through automated review gates to a human decision.

## Lifecycle Steps

```
[1] Evidence Recorded   — Signals (e.g. recurring-failure, workflow-success) are detected and stored.
[2] Proposal Drafted    — The evidence-driven or metric-driven bridge produces an UpgradeProposal draft.
[3] Review Gates Applied — Automated gates (nonRegression, qualityComparison, registryCandidate, staleProposal, …) run and set blockedGateNames.
[4] Human Decision      — A human reviewer promotes, rejects, or defers the proposal.
```

## Governance Fixtures

Four demo proposals illustrate different paths through the loop:

| File | targetSurface | Status | Notes |
|------|--------------|--------|-------|
| `governance/demo-atom-spec-proposal.json` | `atom-spec` | `pending` | All gates pass; awaiting human review |
| `governance/demo-atom-map-proposal.json` | `atom-map` | `pending` | Map curator compose; all gates pass |
| `governance/demo-rejected-proposal.json` | `atom-spec` | `blocked` | `qualityComparison` gate failed |
| `governance/demo-stale-proposal.json` | `atom-spec` | `blocked` | `staleProposal` gate failed (baseAtomVersion behind current) |

## Running

```bash
npm test
# → [example:evolution-loop] ok (evidence → proposal → review → decision)
```

## Related Docs

- `docs/ATOM_EVOLUTION_PLAN.md` — Milestone plan for the evolution loop.
- `docs/LIFECYCLE.md` — Full atom lifecycle reference.
- `packages/core/src/upgrade/metrics-to-proposal.ts` — Metric-driven proposal adapter (M6).
