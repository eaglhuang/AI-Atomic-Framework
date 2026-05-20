# CODEOWNERS Policy

This document defines review ownership and branch protection recommendations for open-source ATM PRs.

## 1. Ownership Layers

| Scope | Required owner |
| --- | --- |
| `packages/core/**` | core maintainers |
| `schemas/**` | core maintainers |
| `compatibility-matrix.json` | core maintainers + release owners |
| `packages/cli/**`, `atm.mjs` | CLI maintainers |
| `packages/integration-*`, `packages/adapter-*`, `packages/language-*` | adapter maintainers |
| `packages/agent-pack-*` | agent-pack maintainers |
| `release/**`, `.github/workflows/release-*`, `known-bad-versions.json` | release owners |
| docs policy surfaces | docs maintainers + relevant code owner |

## 2. Suggested CODEOWNERS

`.github/CODEOWNERS` should include at least:

```text
/packages/core/** @eaglhuang
/schemas/** @eaglhuang
/compatibility-matrix.json @eaglhuang

/packages/cli/** @eaglhuang
/atm.mjs @eaglhuang

/packages/integration-*/** @eaglhuang
/packages/adapter-*/** @eaglhuang
/packages/language-*/** @eaglhuang
/packages/agent-pack-*/** @eaglhuang

/release/** @eaglhuang
/.github/workflows/release-* @eaglhuang
/known-bad-versions.json @eaglhuang
```

After the project has GitHub teams, `@eaglhuang` can be split into team aliases such as `@org/core-maintainers`, `@org/adapter-maintainers`, and `@org/release-owners`.

## 3. Branch Protection

Recommended main branch protections:

- Require pull requests before merging.
- Require approvals from CODEOWNERS.
- Require status checks such as standard validators, release trust, version compatibility, and skew matrix.
- Restrict who can push official release tags.
- Require signed or annotated tags for releases.

## 4. Release Owner Authority

Release Owners are responsible for:

- approving release surface changes;
- running the official release workflow;
- creating annotated tags;
- managing dist-tags;
- starting rollback or known-bad marking.

External contributors may not perform those actions directly.

## 5. Review Escalation

Any PR that touches both core and release surface must receive both core maintainer review and Release Owner review. If a release intent claims `none` while touched paths match release surface, CI should block.
