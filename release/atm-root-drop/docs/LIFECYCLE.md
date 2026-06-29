# Lifecycle Policy

The Plugin SDK is the stable adapter contract for alpha0 adapter authors. Project adapters, language adapters, injector plugins, governance stores, and lifecycle hooks should evolve through this package first.

## Lifecycle Modes

Atom specs declare lifecycle intent through `compatibility.lifecycleMode`.

- `birth` means a new atom is being introduced.
- `evolution` means an existing atom is being upgraded or compared against prior quality metrics.

## Evidence-Driven Evolution

Evidence-driven evolution is an advisory path for drafting `UpgradeProposal` documents from recurring usage signals, corrective evidence, metric regressions, and successful rollback or workflow evidence. It does not create a third lifecycle mode: generated proposals still use `evolution` and must pass the same schema, review, human-decision, behavior, registry-transition, and mutability-policy gates as any other upgrade proposal.

Evidence-driven proposal drafts must be traceable to evidence inputs and should record target surface, proposal source, base target version, evidence watermark, and reversibility metadata when those fields are available. The full rollout plan is documented in `docs/ATOM_EVOLUTION_PLAN.md`.

## Breaking Change Policy

Changes to exported Plugin SDK interfaces are breaking when they remove fields, rename fields, tighten required fields, or move lifecycle meaning out of `compatibility.lifecycleMode`.

Breaking adapter contract changes require a documented migration note, updated validators, and fixture coverage before they can be used by core or CLI workflows. Advisory evolution interfaces such as `VersionResolver`, `QualityMetricsComparator`, and `UpgradeProposalAdapter` may be introduced as optional contracts before becoming mandatory.

Language adapters are also responsible for adapter-native static-check
declaration. New language adapters must implement
`getFastStaticCheck(profile)`, `getDefaultStaticCheck(profile)`, and
`getAllStaticCheck(profile)` so higher ATM layers can request a fast/default/all
static pass without hardcoding one language's toolchain into the product.

Those selectors are a required compatibility surface, not optional guidance.
When a new adapter is introduced, its migration note should cover:

- what each tier runs and why;
- which warnings/errors are expected to be cleaned in touched scope;
- which validator or integration fixture proves runtime readiness and adapter
  selectors still agree.
- which `docs/` contract pages were updated so agent-facing guidance stays in
  parity with the implementation.
