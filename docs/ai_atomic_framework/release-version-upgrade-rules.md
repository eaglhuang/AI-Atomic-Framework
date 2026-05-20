# ATM Release Version Upgrade Rules

ATM uses one framework release train plus release impact metadata. Version numbers follow SemVer and describe compatibility only; package group, core/peripheral impact, migration risk, and review ownership are recorded in release intents and release manifests.

## Release Train

- `frameworkVersion` must be `MAJOR.MINOR.PATCH[-alpha.N|-beta.N|-rc.N|-canary.<date>.<sha>]`.
- Do not encode `core`, `peripheral`, or package group meaning into numeric version segments.
- Official public packages stay on the fixed ATM release train unless an RFC approves independent versioning.
- Core bugfixes and peripheral bugfixes are both patch releases; the release manifest records which package group changed.

## Required Release Intent

Every release-relevant PR must include metadata equivalent to:

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

The highest `release_impact` decides the next version. `core_impact` controls core-specific review and migration gates.

## Upgrade Flow

1. Discover version policy, package groups, CODEOWNERS, and release intents.
2. Classify changed files as core, public, non-public, docs, tooling, peripheral, or release surface.
3. Validate or generate release impact metadata.
4. Decide patch, minor, major, or prerelease from the highest impact.
5. Validate contributor rules, especially for core and release surface changes.
6. Freeze only release surfaces, not unrelated feature branches.
7. Prepare package versions, compatibility matrix, lockfile, skew matrix, release notes, and release manifest.
8. Run standard validators, root-drop and onefile checks, adapter install smoke, and fresh adopter smoke.
9. Let the Release Owner create an annotated `v<frameworkVersion>` tag.
10. Record artifacts, dist-tag, rollback route, and known-bad readiness.

## Release Owner Boundary

External contributors may submit core PRs, but they may not trigger official framework releases, create release commits, push official tags, or publish npm dist-tags. Those actions require a Release Owner or explicitly authorized maintainer.

## Related Documents

- `docs/ai_atomic_framework/open-source-versioning-policy.md`
- `docs/ai_atomic_framework/contributor-release-impact.md`
- `docs/ai_atomic_framework/release_version_flow/ATM_VERSION_UPGRADE_RULES.md`
