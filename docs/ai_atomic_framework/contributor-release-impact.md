# Contributor Release Impact

This guide explains how contributors describe release impact before maintainers decide the next ATM framework version.

## When an Intent Is Required

Add a release intent or changeset when a PR changes:

- `packages/core/**`, `schemas/**`, or `compatibility-matrix.json`
- CLI commands, output, exit codes, or public behavior
- adapter, plugin, language adapter, or agent-pack public behavior
- release workflows, dist-tags, known-bad versions, root-drop, or onefile artifacts
- public documentation that changes compatibility, migration, or support promises

## Intent Format

```yaml
package_group: adapter
public_api: true
release_impact: patch
core_impact: none
requires_migration: false
requires_release_note: true
issue_or_rfc: ""
```

The body should explain the summary, public surface, migration requirements, tests, and rollback notes.

## Impact Examples

| Change | release_impact | core_impact |
| --- | --- | --- |
| Typo-only docs | none | none |
| Adapter bugfix | patch | none |
| CLI compatible feature | minor | none |
| Core bugfix | patch | patch |
| Core compatible feature | minor | minor |
| Breaking schema change | major | major |
| Release workflow fix | patch | none |

## External Contributor Boundary

External contributors may submit core PRs, but core PRs require issue/RFC links, release intent, CODEOWNERS review, migration assessment, and integration tests. External contributors may not trigger official releases, create release commits, push official tags, or publish npm dist-tags.
