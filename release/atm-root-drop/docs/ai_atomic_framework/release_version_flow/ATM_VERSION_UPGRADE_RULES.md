# ATM Version Upgrade Rules

This rulebook combines ATM's version upgrade path, QA gates, release notes, tagging, rollback, and open-source PR policy.

## A. Discover

Before an upgrade, read:

- `docs/ai_atomic_framework/upstream-versioning-policy.md`
- `docs/ai_atomic_framework/release_version_flow/OPEN_SOURCE_VERSIONING_POLICY.md`
- `docs/ai_atomic_framework/release_version_flow/PACKAGE_GROUPS.md`
- `.github/CODEOWNERS`
- `.atm/release-intents/*.md` or Changesets

Automation should provide a classify command that reads touched files and outputs package group, public API, release surface, and impact metadata.

## B. Classify

Classify touched files into:

- `core`
- `public`
- `non-public`
- `docs`
- `tooling`
- `peripheral`
- `release surface`

The classification must map to `package_group` and `public_api`.

## C. Impact

Require or generate release impact metadata:

```yaml
package_group: core
public_api: true
release_impact: patch
core_impact: patch
requires_migration: false
requires_release_note: true
```

If a PR lacks release intent while touched paths match release-relevant scope, the upgrade flow must block.

## D. Version Decision

The highest `release_impact` determines the next version:

- all `none`: no version bump.
- max `patch`: increment `PATCH`.
- max `minor`: increment `MINOR` and reset `PATCH` to `0`.
- max `major`: increment `MAJOR` and reset `MINOR` and `PATCH` to `0`.
- prerelease: use `alpha.N`, `beta.N`, `rc.N`, or `canary.<date>.<sha>`.

During `0.x`, `MINOR` requires migration notes when adopter-visible behavior changes.

## E. Validate Contributor Rules

External PRs must be checked for:

- issue or RFC links on core PRs;
- CODEOWNERS review on core PRs;
- migration assessment on core PRs;
- tests for public behavior;
- Release Owner review for release surface changes;
- no official tags, release commits, or dist-tags created by external contributors.

Automation should provide contributor-impact and CODEOWNERS validation commands. It should block, or at least emit a blocking warning, when release-relevant PRs lack release intent.

## F. Freeze

Freeze release surface only. Do not freeze unrelated feature branches.

Freeze:

- package version fields
- `compatibility-matrix.json`
- release notes
- root-drop and onefile artifacts
- release workflow
- dist-tag decisions
- known-bad readiness

Do not freeze:

- unrelated feature branches
- documentation draft branches
- downstream adopter experiments

## G. Prepare Release

The Release Owner prepares:

- package version synchronization;
- compatibility matrix synchronization;
- lockfile updates;
- skew matrix generation;
- release notes;
- release manifest;
- rollback route.

## H. QA Gates

Standard gates:

```bash
node --experimental-strip-types scripts/validate-version-compatibility.ts --mode validate
node --experimental-strip-types scripts/validate-release-trust.ts --mode validate
node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate
npm run validate:standard
```

Release artifact gates:

- root-drop validation;
- onefile validation;
- adapter install smoke;
- fresh adopter smoke;
- known-bad readiness.

## I. Tag

Official release tags can be created only by a Release Owner or an explicitly authorized maintainer.

- Use annotated tags.
- Tags must match `v<frameworkVersion>`.
- Tag version must match the root package, workspace packages, and compatibility matrix.
- Prerelease tags must map to the correct npm dist-tag.

## J. Post-release

After release, record:

- artifact paths;
- integrity manifest;
- SBOM;
- dist-tag;
- release notes;
- rollback route;
- known-bad update path;
- compatibility matrix diff PR.

## K. Rollback and Known-bad

If a release has an incident:

- mark the version as known-bad first;
- retract or adjust dist-tags;
- publish a patch rollback or forward fix;
- preserve incident evidence;
- update release trust docs.

Rollback must not use a non-standard version number. It still follows SemVer patch or hotfix prerelease rules.
