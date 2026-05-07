# Local Governance Reference Plugins

This package provides the local filesystem reference implementation for the default ATM governance bundle.

It keeps governance behavior outside `packages/core` while still giving blank repositories a canonical `.atm/` task, lock, artifact, log, report, state, evidence, and context budget surface.

Primary exports:

- `createLocalGovernanceStores()`
- `createLocalGovernanceAdapter()`
- `adoptLocalGovernanceBundle()`
- `createOfficialBootstrapCommand()`
- `createRecommendedPrompt()`
- `createSelfHostingAlphaPrompt()`

The package is intentionally host-neutral and only depends on upstream core and plugin-sdk contracts.