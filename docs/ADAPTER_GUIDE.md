# Adapter Guide

This guide defines the stable Plugin SDK contract for adapter authors.

## Lifecycle Modes

Adapters receive `lifecycleMode` as `birth` or `evolution`. The value is declared in `packages/plugin-sdk/src/lifecycle.ts` and is mapped in atom specs through `compatibility.lifecycleMode`. Do not create a second top-level lifecycle field in atom specs.

## Project Adapters

`ProjectAdapter` is the repository-facing boundary. A project adapter owns repository setup, work item preparation, finalization, and access to governance stores. It exposes capabilities, lifecycle hooks, default config, and the store collection defined under `packages/plugin-sdk/src/governance`.

## Language Adapters

`LanguageAdapter` is the language-facing boundary. It detects a project profile and validates compute atoms from source files plus policy. Language-specific packages may add richer request and report types, but should remain assignable to the SDK shape.

## Governance Stores

The SDK defines interface-only stores for tasks, locks, document indexes, shards, artifacts, logs, run reports, markdown/json state, rule guards, evidence, registries, and context summaries. Implementations can use files, databases, or hosted services, but Plugin SDK does not prescribe storage.

## Governance Layout

`packages/plugin-sdk/src/governance/layout.ts` exports `GovernanceLayout`, `GovernanceAdapter`, and `defaultGovernanceLayout`. The alpha0 reference layout uses `.atm/tasks`, `.atm/locks`, `.atm/index`, `.atm/shards`, `.atm/state`, `.atm/artifacts`, `.atm/logs`, `.atm/reports`, `.atm/rules`, and `.atm/evidence` as the default store roots. External adapters may map the same contract onto Jira, GitHub Issues, or another host store, but the SDK still treats the layout as a portable contract.

`RunReportStore` is reserved here so alpha0 can name the report boundary without freezing the richer report schema too early; ATM-2-0009 expands the detailed report and evidence contracts.

## Injector Plugins

`InjectorPlugin` is for host integration. It declares capabilities, lifecycle hooks, and an `inject` method that receives the host context without making the core framework depend on a host implementation.

## Evolution Interfaces

`VersionResolver`, `QualityMetricsComparator`, and `UpgradeProposalAdapter` live in the Plugin SDK interface layer. They are advisory for alpha0 gates unless a task explicitly makes them blocking.