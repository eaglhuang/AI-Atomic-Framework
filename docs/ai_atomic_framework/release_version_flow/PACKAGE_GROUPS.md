# Package Groups

This document defines ATM monorepo package groups and fixed release train rules.

## 1. Group Definitions

| Group | Scope | Default versioning |
| --- | --- | --- |
| `core` | `packages/core/**`, `schemas/**`, `compatibility-matrix.json` | fixed `frameworkVersion` |
| `cli` | `packages/cli/**`, `atm.mjs` | fixed `frameworkVersion` |
| `plugin-sdk` | `packages/plugin-sdk/**` | fixed `frameworkVersion` |
| `adapter` | `packages/adapter-*`, `packages/integration-*`, `packages/language-*`, `packages/plugin-*` | fixed `frameworkVersion` |
| `agent-pack` | `packages/agent-pack-*`, integration templates | fixed `frameworkVersion` |
| `docs` | public docs, migration guides, example docs | release note only unless the public contract changes |
| `tooling` | scripts, release workflows, root-drop or onefile build tooling | fixed `frameworkVersion` when public release surface changes |
| `example` | `examples/**`, samples, fixtures | usually none or patch |

## 2. Fixed Train Rules

Fixed alignment means package versions are synchronized during a framework release. It does not mean every touched package forces a version bump. The version level is determined by the highest release impact.

Examples:

- docs typo: no version bump.
- adapter bug fix: patch.
- core compatible feature: minor.
- schema breaking change: major.

## 3. Independent Versioning Candidates

The following may become candidates for independent versioning:

- A single adapter is independently pinned by downstream consumers.
- An agent pack has a release cadence independent from the framework.
- A plugin has a standalone public API and support window.

Before an RFC is approved, these packages remain on the fixed framework train.

## 4. Release Manifest Representation

```yaml
frameworkVersion: 0.2.0
releaseTrain: fixed
packages:
  - name: "@ai-atomic-framework/core"
    package_group: core
    version: 0.2.0
  - name: "@ai-atomic-framework/adapter-local-git"
    package_group: adapter
    version: 0.2.0
impacts:
  - package_group: core
    release_impact: minor
    core_impact: minor
```

## 5. Disallowed Patterns

- Do not use `0.1.99.xxx` to imply a peripheral patch.
- Do not map package groups to numeric SemVer segments.
- Do not let adapters use independent versions before an approved RFC.
- Do not publish release notes that list only a version number without impact metadata.
