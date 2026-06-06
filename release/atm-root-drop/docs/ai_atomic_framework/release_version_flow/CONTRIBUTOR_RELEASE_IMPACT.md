# Contributor Release Impact Guide

This guide explains how external contributors describe release impact and how maintainers evaluate `release_impact`.

## 1. When Release Intent Is Required

Release intent is required when a PR changes:

- `packages/core/**`, `schemas/**`, or `compatibility-matrix.json`;
- CLI commands, output format, exit codes, or public behavior;
- adapter, plugin, language adapter, or agent-pack public behavior;
- release workflows, known-bad lists, dist-tags, root-drop, or onefile artifacts;
- public documentation that changes compatibility, migration, or support promises.

`release_impact: none` can be used for:

- typo-only documentation changes that do not change the public contract;
- test fixtures or internal refactors that do not change public behavior;
- repository housekeeping that does not affect install, CLI, schemas, or adopter flow.

## 2. Release Intent Format

During the early ATM release flow, `.atm/release-intents/<slug>.md` can use this format:

```markdown
---
package_group: core
public_api: true
release_impact: minor
core_impact: minor
requires_migration: true
requires_release_note: true
issue_or_rfc: https://github.com/eaglhuang/AI-Atomic-Framework/issues/123
---

# Release Intent: Registry compatibility expansion

## Summary
Describe what changed and why adopters care.

## Public Surface
- schema field
- CLI output
- migration behavior

## Migration
Explain required migration or state "none".

## Tests
List validators, integration tests, and adopter smoke checks.
```

If Changesets are introduced, their fields must map one-to-one to changelog and versioning decisions.

## 3. Impact Matrix

| Change type | release_impact | core_impact | Notes |
| --- | --- | --- | --- |
| Docs typo | none | none | Does not enter release notes. |
| Docs policy contract | patch | none | Requires release notes when the contract changes. |
| Adapter bug fix | patch | none | Public behavior fix. |
| Adapter feature | minor | none | Backward-compatible addition. |
| Core non-public refactor | none | none | Requires tests proving public behavior is unchanged. |
| Core bug fix | patch | patch | Requires core owner review. |
| Core compatible feature | minor | minor | During `0.x`, include migration notes when needed. |
| Core breaking change | major | major | Requires RFC, migration, and rollback. |
| Release workflow change | patch | none | Requires Release Owner review. |

## 4. External PR Checklist

- Provide release intent or a changeset.
- Link an issue or RFC when touching core.
- State whether migration is required.
- List tests and validators.
- Do not create release commits, push tags, or publish npm packages.
- Wait for CODEOWNERS and Release Owner review when required.

## 5. Maintainer Review Checklist

- Release intent fields are complete.
- Package group matches touched paths.
- The highest impact can mechanically derive the next version level.
- Core PRs include migration and test evidence.
- Release surface PRs have Release Owner review.
- Release notes and changelog do not omit public behavior changes.
