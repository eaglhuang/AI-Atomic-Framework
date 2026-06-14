# ATM Core Runner Scope

`runner-build-scope.json` is the lightweight Runner Sync Steward v1 contract.

It separates runner-affecting source from generated runner outputs:

- Source agents may edit declared runner-affecting source roots and record `runner-sync-needed`.
- Source agents must not publish `release/**` artifacts as part of ordinary source delivery.
- The runner sync steward is the single writer for generated runner artifacts.
- New runner-affecting scripts should live under `scripts/AtmCore/` or be declared in `runner-build-scope.json`.

This is intentionally lighter than the full Runner Broker design. It gives the stale-runner gate and later classifier a machine-readable scope without requiring every agent to understand refs, envelopes, or closure binding.
