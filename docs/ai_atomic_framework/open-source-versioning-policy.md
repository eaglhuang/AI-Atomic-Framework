# Open Source Versioning Policy

ATM follows standard SemVer and a fixed framework release train during the early open-source phase.

## SemVer Contract

`frameworkVersion` must use:

```text
MAJOR.MINOR.PATCH[-alpha.N|-beta.N|-rc.N|-canary.<date>.<sha>]
```

Do not use non-standard version shapes such as `0.1.99.xxx`. Do not encode package group, subsystem, or core/peripheral meaning into numeric version segments.

## Fixed Package Train

Official public packages stay aligned to the framework version by default:

- core
- cli
- plugin-sdk
- adapters and integrations
- language adapters
- agent packs
- official release artifacts

Independent package versioning is allowed only after an RFC proves independent consumers, cadence, compatibility range, docs, CI, and support ownership.

## Impact Metadata

Release impact is expressed outside the version number:

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

This metadata feeds changelog generation, version decisions, owner review, migration gates, and release notes.

## Release Surface

Release Owner review is required for:

- `release/**`
- `.github/workflows/release-*`
- `compatibility-matrix.json`
- `known-bad-versions.json`
- package version fields
- dist-tag policy
- root-drop and onefile release scripts
- migration guides and release notes

## Source of Truth

When written policy, compatibility matrix, release intent, and package versions disagree, release validation must fail until they are aligned.
