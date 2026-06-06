# `@ai-atomic-framework/plugin-governance-local` — Public Export Maturity

This document inventories every exported symbol from this package, classifies
it by maturity tier, and pins down which exports are stable contracts vs which
are transitional alpha surface that may move during a future split.

This is the SSoT for any caller deciding whether to depend on a particular
export. The package's `index.ts` is the runtime entry point; this document is
the documentation entry point.

## Maturity tiers

| Tier | Meaning |
|---|---|
| **stable** | Public contract. Breaking changes require a minor version bump + migration note. |
| **beta** | Public-facing but signature may evolve. Breaking changes require a deprecation cycle. |
| **alpha** | Transitional — exposed because callers exist, but the right home is undecided. May move to a new module without a deprecation cycle as long as a re-export shim is left behind. |
| **internal** | Not part of the public contract. Listed only because TypeScript currently exports them; callers MUST NOT depend on them. |

## Exports inventory

### Package identity

| Symbol | Tier | Notes |
|---|---|---|
| `pluginGovernanceLocalPackage` | stable | Package name / role / version constant. Read by CLI and adopter sentinel. |

### Adapter factory

| Symbol | Tier | Notes |
|---|---|---|
| `createLocalGovernanceAdapter` | stable | Returns a `GovernanceAdapter` for the local layout. Primary plugin-SDK contract. |
| `LocalGovernanceConfig` (type) | stable | Adapter factory input shape. |

### Bootstrap (the one big one)

| Symbol | Tier | Notes |
|---|---|---|
| `adoptLocalGovernanceBundle` | **beta** | The 200-line bootstrap function. Stable JSON output shape (consumed by `init.ts`), but internal helpers are being refactored. Future split target. |
| `LocalGovernanceBootstrapOptions` (type) | stable | Bootstrap input. |
| `LocalGovernanceBootstrapResult` (type) | stable | Bootstrap return value. Public CLI surface. |
| `LocalGovernancePinnedRunnerResult` (type) | stable | Pinned-runner metadata shape; persisted to `.atm/runtime/pinned-runner.json`. |
| `installRootDropScripts` | beta | Standalone script installer; may move to `bootstrap/root-drop.ts` in a future split. |
| `LocalGovernanceScriptInstallResult` (type) | stable | Return value of `installRootDropScripts`. |

### Prompts / commands

| Symbol | Tier | Notes |
|---|---|---|
| `createOfficialBootstrapCommand` | stable | Returns the canonical `node atm.mjs bootstrap …` command string. |
| `createRecommendedPrompt` | stable | The neutral agent prompt rendered into AGENTS.md. |
| `createSelfHostingAlphaPrompt` | beta | Slightly shorter variant for self-host alpha smoke. |

### Context budget / continuation

| Symbol | Tier | Notes |
|---|---|---|
| `estimateContextBudgetTokens` | beta | Pure helper, but may move to `packages/core/src/budget/`. |
| `createContinuationSummaryRecord` | beta | Shape stable, location may move. |
| `createContinuationRunReport` | beta | Same as above. |
| `ContinuationContractInput` (type) | stable | Input shape consumed by both helpers. |

### Re-exported from submodules

| Symbol | Tier | Origin | Notes |
|---|---|---|---|
| `resolveLocalGovernanceLayout` | stable | `./layout.ts` | Layout resolver. Used by CLI `governance-runtime.ts`. |
| `createLocalGovernanceStores` | stable | `./stores.ts` | Store factory wired into the adapter. |
| `createDefaultGuards` | stable | `./default-guards.ts` | Builds the default guard bundle from project probe. |
| `defaultGuardCatalog` | stable | `./default-guards.ts` | Static guard ID list — also referenced by validators. |

## Split plan (informational, not implemented in this card)

When this package is split (tracked by a future ATD card), the natural
boundaries are:

1. **`bootstrap/`** — `adoptLocalGovernanceBundle`, `installRootDropScripts`,
   `installPinnedRunner`, all `createBootstrap*` helpers, migration helpers,
   template rendering helpers.
2. **`prompt/`** — `createOfficialBootstrapCommand`,
   `createRecommendedPrompt`, `createSelfHostingAlphaPrompt`.
3. **`budget/`** — `estimateContextBudgetTokens`,
   `createContinuationSummaryRecord`, `createContinuationRunReport`,
   `ContinuationContractInput`, the context budget evaluator and summary
   renderer.
4. **`index.ts` (stays)** — package identity, `createLocalGovernanceAdapter`,
   re-exports from `./layout.ts` / `./stores.ts` / `./default-guards.ts`, and
   stable re-exports from the new submodules.

**Why not split now**: every public re-export must remain reachable from
`index.ts` to preserve I5 (manifest stability) and avoid breaking adopter
manifests. A safe split needs (a) coverage by `tests/agent-pack/install-uninstall-roundtrip.test.ts`,
(b) a manifest-hash regression fixture, and (c) a deprecation note in any
docs that link directly to internal helpers. Those are tracked as their own
follow-up.

## Stability commitment for current alpha

Until the split lands:

- All symbols listed above MAY change implementation internally but their
  exported names MUST remain reachable from `index.ts`.
- JSON outputs persisted to `.atm/runtime/**` and `.atm/history/**` follow the
  declared `schemaVersion` and require a migration note for any change.
- The `LocalGovernanceBootstrapResult` shape is locked by
  `tests/agent-pack/install-uninstall-roundtrip.test.ts` — any field
  rename/removal there is a breaking change.
