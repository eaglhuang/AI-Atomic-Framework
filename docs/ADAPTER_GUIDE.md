# Adapter Guide

This guide defines the stable Plugin SDK contract for adapter authors.

## Lifecycle Modes

Adapters receive `lifecycleMode` as `birth` or `evolution`. The value is declared in `packages/plugin-sdk/src/lifecycle.ts` and is mapped in atom specs through `compatibility.lifecycleMode`. Do not create a second top-level lifecycle field in atom specs.

## Project Adapters

`ProjectAdapter` is the repository-facing boundary. A project adapter owns repository setup, work item preparation, finalization, and access to governance stores. It exposes capabilities, lifecycle hooks, default config, and the store collection defined under `packages/plugin-sdk/src/governance`.

For legacy strangler flows, `ProjectAdapter` also owns `resolveLegacyUri`, `runAtomizeAdapter`, and `runInfectAdapter`. These methods standardize `legacy://<repository>/<path>[#Lx-Ly]` parsing, require a dry-run patch contract that keeps `applyToHostProject=false`, and must attach a neutrality summary before an adapter hands any payload to proposal review.

## Language Adapters

`LanguageAdapter` is the language-facing boundary. It detects a project profile and validates compute atoms from source files plus policy. Language-specific packages may add richer request and report types, but should remain assignable to the SDK shape.

Every language adapter must also implement three static-check selectors:

- `getFastStaticCheck(profile)`
- `getDefaultStaticCheck(profile)`
- `getAllStaticCheck(profile)`

These methods return a `LanguageAdapterStaticCheckPlan` with ordered commands,
their origin, estimated cost, and the check kinds they cover. Use this
contract when ATM needs an adapter-native "quick static pass" instead of
guessing from repository files or hardcoding ESLint-only behavior in the CLI.

The intent is product-wide parity, not one-off language exceptions:

- `fast` should be the cheapest broad signal that catches touched-scope syntax/import/type drift early.
- `default` should be the normal pre-next / pre-close static lane that most governed work can afford to run routinely.
- `all` should stay static-only, but may combine the adapter's full declared static surfaces when a stricter sweep is needed.

The contract is also what powers adapter-aware governance hints and integration
tests. New language adapters should ship fixture-backed validation proving that
their three selectors stay aligned with runtime readiness reporting.

When an adapter adopts a map-managed atom, it should use `node atm.mjs registry lineage backfill` to backfill `members[].versionLineage` on the owning map record from real lineage evidence. That lineage contract lets `registry-diff` and onefile smoke checks resolve adopter-owned atoms even when there is no standalone atom entry, while keeping dry-run patches and apply-mode evidence gates deterministic.

## Atomization Planning (Optional)

`packages/plugin-sdk/src/atomization-planning.ts` defines the optional `AtomizationPlanningAdapter` capability for language adapters that can discover atom candidates and propose dry-run atomization plans:

- `discoverAtomCandidates(request)` returns `AtomCandidate` records (kind: `function` / `class` / `module` / `route` / `command` / `schema` / `unknown`) with a confidence level and a declared detection method.
- `planAtomize(request)` returns an `AtomizationPlan` that is always `dryRun: true`: it lists `patchFiles`, ordered `AtomizationPlanStep`s, required evidence, and rollback notes, but never mutates the host project.

Implement this contract when your adapter can cheaply enumerate extractable units; skip it otherwise. The contract is additive: `LanguageAdapter` is unchanged, ATM core feature-detects the capability before use, and adapters that do not implement it remain fully valid.

The detection method may be `regex`, `scanner`, `compiler-api`, `ast`, `lsp`, or `llm-assisted` — none is mandatory. A line-oriented scanner with honest `confidence` values is an acceptable first implementation; record the method on each candidate so downstream consumers can weigh precision accordingly.

Schema shapes can be checked at plugin boundaries with the exported `isAtomCandidate` and `isAtomizationPlan` runtime guards. The reference implementation is the Python adapter (`createPythonAtomizationPlanningAdapter` in `packages/language-python`).

## Governance Stores

The SDK defines interface-only stores for tasks, locks, document indexes, shards, artifacts, logs, run reports, markdown/json state, rule guards, evidence, registries, context summaries, and `ContextBudgetGuard`. Implementations can use files, databases, or hosted services, but Plugin SDK does not prescribe storage.

## Governance Layout

`packages/plugin-sdk/src/governance/layout.ts` exports `GovernanceLayout`, `GovernanceAdapter`, and `defaultGovernanceLayout`. The alpha0 reference layout uses the v2 `runtime/history/catalog` split: `.atm/history/tasks`, `.atm/history/task-events`, `.atm/runtime/locks`, `.atm/catalog/index`, `.atm/catalog/shards`, `.atm/runtime/state`, `.atm/history/artifacts`, `.atm/history/logs`, `.atm/history/reports`, `.atm/runtime/rules`, `.atm/history/evidence`, `.atm/runtime/budget`, and `.atm/history/handoff`. External adapters may map the same contract onto Jira, GitHub Issues, or another host store, but the SDK still treats the layout as a portable contract.

`RunReportStore` is reserved here so alpha0 can name the report boundary without freezing the richer report schema too early; ATM-2-0009 expands the detailed report and evidence contracts. `ContextBudgetGuard` gives adapters a model-neutral place to persist policy, evaluate estimated context load, and emit `pass`, `summarize-before-continue`, or `hard-stop` decisions without baking a host's prompt habits into core.

## Injector Plugins

`InjectorPlugin` is for host integration. It declares capabilities, lifecycle hooks, and an `inject` method that receives the host context without making the core framework depend on a host implementation.

## Test Runner Plugins

`packages/plugin-sdk/src/test-runner.ts` defines the alpha0 `TestRunnerPlugin` contract and the companion `AtomicTestRunnerConfig` sidecar model. The current integration path is intentionally light-weight:

- keep the atom spec focused on the atom itself;
- put plugin wiring and default gate fixtures in a sibling `*.test-runner.json` file;
- let `node atm.mjs test --spec <atom-spec>` auto-discover that sidecar and merge it with legacy `validation.commands`.

Use plugins when the host repository already owns unit, integration, golden, or domain validators and ATM should only orchestrate them and normalize the evidence envelope. Use `defaultGates` when the host wants ATM's built-in immutability, side-effect, or consumer-contract fixture vocabulary without writing a custom plugin first.

## Evolution Interfaces

`VersionResolver`, `QualityMetricsComparator`, and `UpgradeProposalAdapter` live in the Plugin SDK interface layer. They are advisory for alpha0 gates unless a task explicitly makes them blocking.
