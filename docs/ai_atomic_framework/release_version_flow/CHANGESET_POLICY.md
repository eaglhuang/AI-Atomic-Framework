# Changeset Policy

ATM release intent can be represented by Changesets or, during the early flow, by `.atm/release-intents/*.md`. Either representation must preserve mechanically convertible release impact metadata.

## 1. Required Fields

```yaml
package_group: core | cli | plugin-sdk | adapter | agent-pack | docs | tooling | example
public_api: true | false
release_impact: none | patch | minor | major
core_impact: none | patch | minor | major
requires_migration: true | false
requires_release_note: true | false
```

Recommended fields:

```yaml
issue_or_rfc: "<url-or-id>"
affected_packages:
  - "@ai-atomic-framework/core"
validators:
  - "npm run validate:standard"
release_surface: true | false
```

## 2. When `none` Is Allowed

`release_impact: none` is allowed for:

- docs typo fixes;
- tests-only changes that do not change public fixtures;
- internal refactors that do not change public API or behavior;
- build script cleanup that does not affect release artifacts.

`none` is not allowed for:

- CLI output or exit code changes;
- schema or compatibility matrix changes;
- adapter public behavior changes;
- release workflow, dist-tag, known-bad, or root-drop changes;
- public docs that change compatibility promises or migration guarantees.

## 3. Patch, Minor, Major

`patch`:

- backward-compatible bug fixes;
- release tooling fixes;
- adapter public behavior bug fixes.

`minor`:

- backward-compatible features;
- new adapter capability;
- core compatible features. During `0.x`, include migration notes when needed.

`major`:

- breaking public API changes;
- incompatible schema, CLI, or release artifact changes;
- releases that require manual adopter migration.

## 4. Changelog Generation

Release notes must be generated from release intent:

- group entries by `package_group`;
- show `release_impact` and `core_impact`;
- list migration requirements;
- list Release Owner and code owner review;
- list validator evidence.

## 5. Validation

CI should verify:

- release-relevant paths have release intent;
- release intent fields are valid;
- touched paths match `package_group`;
- the highest impact matches the proposed next version;
- core impact has core review;
- release surface has Release Owner review.
