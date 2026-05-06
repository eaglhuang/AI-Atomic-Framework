# Lifecycle Policy

The Plugin SDK is the stable adapter contract for alpha0 adapter authors. Project adapters, language adapters, injector plugins, governance stores, and lifecycle hooks should evolve through this package first.

## Lifecycle Modes

Atom specs declare lifecycle intent through `compatibility.lifecycleMode`.

- `birth` means a new atom is being introduced.
- `evolution` means an existing atom is being upgraded or compared against prior quality metrics.

## Breaking Change Policy

Changes to exported Plugin SDK interfaces are breaking when they remove fields, rename fields, tighten required fields, or move lifecycle meaning out of `compatibility.lifecycleMode`.

Breaking adapter contract changes require a documented migration note, updated validators, and fixture coverage before they can be used by core or CLI workflows. Advisory evolution interfaces such as `VersionResolver`, `QualityMetricsComparator`, and `UpgradeProposalAdapter` may be introduced as optional contracts before becoming mandatory.