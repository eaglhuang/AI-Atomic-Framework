# Open Source Versioning Policy

This policy defines ATM's public version semantics, package groups, release train, and release impact metadata for the open-source distribution.

## 1. Standard SemVer

ATM uses standard SemVer only:

```text
MAJOR.MINOR.PATCH[-alpha.N|-beta.N|-rc.N|-canary.<date>.<sha>]
```

Do not use `0.1.99.xxx`, `0.1.<group>.<patch>`, or any other non-standard version shape that encodes a package group into the version number. The version number communicates compatibility only:

- `MAJOR`: incompatible changes to public APIs, schemas, CLI behavior, or the release surface.
- `MINOR`: backward-compatible features. During `0.x`, a minor release can still be adopter-visible and must include migration notes when needed.
- `PATCH`: backward-compatible bug fixes, documentation corrections, or release tooling fixes.
- Prerelease: alpha, beta, rc, or canary channels.

## 2. Single Framework Release Train

ATM uses a fixed release train during the early open-source phase. Official public packages are aligned to the same `frameworkVersion` by default.

The fixed train applies to:

- `packages/core`
- `packages/cli`
- `packages/plugin-sdk`
- `packages/adapter-*`
- `packages/integration-*`
- `packages/agent-pack-*`
- `packages/language-*`
- official root-drop and onefile release artifacts

Fixed version alignment does not mean every package change has the same release impact. The impact level is declared through release intent metadata.

## 3. Independent Versioning Eligibility

Peripheral packages may move to independent versioning only after an approved RFC proves:

- The package has independent consumers.
- The package has an independent release cadence.
- The package has a separately testable compatibility range.
- The split will not make the framework release manifest, support window, or adopter onboarding harder to understand.

Until that RFC is approved, peripheral packages remain on the fixed framework train.

## 4. Release Impact Metadata

Every release-relevant PR must provide metadata equivalent to:

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

The highest `release_impact` determines the next framework version level. `core_impact` determines core-specific gates, owner review, and migration checks.

## 5. Core vs Peripheral Impact

Core fixes and peripheral fixes are both `PATCH` releases when they are backward compatible. The difference belongs in the release manifest, not in the version number:

```yaml
frameworkVersion: 0.1.4
impacts:
  - package_group: core
    release_impact: patch
    core_impact: patch
    summary: Fix registry version compatibility fallback.
  - package_group: adapter
    release_impact: patch
    core_impact: none
    summary: Fix local-git evidence path normalization.
```

## 6. Release Surface

The following paths are release surface and require Release Owner review:

- `release/**`
- `.github/workflows/release-*`
- `compatibility-matrix.json`
- `known-bad-versions.json`
- package version fields
- dist-tag policy
- root-drop and onefile release scripts
- migration guides and release notes

## 7. Policy Priority

If policy docs, release intents, the compatibility matrix, or package versions disagree, release validation must block until the inconsistency is resolved.
