# Core Change Policy

ATM core accepts external contributions, but core PRs must pass a higher bar because core changes affect all adopters, adapters, and release artifacts.

## 1. Core Scope

The following are core scope:

- `packages/core/**`
- `schemas/**`
- `compatibility-matrix.json`
- public compatibility fields in `atomic-registry.json`
- framework-level invariants
- registry lifecycle, evidence schemas, scope locks, and context summary contracts

## 2. Required Core PR Evidence

Core PRs must include:

- an issue or RFC link;
- a release intent or changeset;
- CODEOWNERS core maintainer review;
- a public API assessment;
- a migration note, or explicit `requires_migration: false`;
- integration tests or validator evidence;
- a rollback route or state repair plan.

## 3. Breaking Changes

Breaking changes include:

- removing or renaming public schema fields;
- changing public CLI output, exit codes, or command behavior;
- changing compatibility matrix interpretation;
- making existing adopter repositories unable to run read-only diagnostics;
- changing release artifact install or upgrade contracts.

Breaking changes require:

- RFC approval;
- `release_impact: major`;
- `core_impact: major`;
- a migration guide;
- release notes;
- a rollback route;
- fresh adopter smoke evidence.

During `0.x`, a `MINOR` release can still include adopter-visible changes. Any adopter-visible break still requires a migration note.

## 4. Core Bug Fixes

Core bug fixes use `PATCH`, but they still require core gates:

- regression tests;
- no compatibility matrix regression;
- root-drop and onefile smoke remain green;
- state-interpretation fixes include known-bad readiness or rollback notes when relevant.

## 5. Non-public Core Refactors

If a core refactor does not change public API or behavior, it may declare:

```yaml
package_group: core
public_api: false
release_impact: none
core_impact: none
requires_migration: false
requires_release_note: false
```

Maintainers must still confirm tests cover the relevant public behavior and that release notes are not required.

## 6. Review Authority

External contributors may submit core PRs, but they may not approve a release, create a release commit, push official tags, or publish packages. A Release Owner may proceed only after all core gates are green.
