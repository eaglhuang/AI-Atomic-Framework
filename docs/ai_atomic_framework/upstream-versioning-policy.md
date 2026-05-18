---
policy_version: 0.1
framework_version_range: ">=0.1.0 <1.0.0"
---

# Upstream Versioning Policy

This policy is the upstream framework contract for release versioning, compatibility matrix review, deprecation timing, and policy self-versioning. Programmatic truth still lives in `compatibility-matrix.json`; this document records the human policy that validators and release workflows must enforce.

## 1. Version Truth Layers

1. `compatibility-matrix.json` is the machine-readable release-train truth.
2. `docs/ai_atomic_framework/upstream-versioning-policy.md` is the written policy surface.
3. README, CONTRIBUTING, migration guides, and release notes explain how contributors follow the policy.

When these layers disagree, release validation must fail until the machine-readable and written contracts are aligned.

## 2. Release Tiers

| Tier | Version shape | Compatibility promise |
| --- | --- | --- |
| alpha | `0.x.y-alpha.n` or early `0.x.y` | APIs may change, but destructive migration still needs an explicit plan and rollback. |
| beta | `0.x.y-beta.n` | Public surfaces should avoid breakage without deprecation and migration guidance. |
| stable | `>=1.0.0` | SemVer breaking changes require the full deprecation cycle. |
| lts | maintained stable line | Removals require the longest retirement window. |

## 3. Deprecation Cycle

Deprecation removal is gated by time and framework minor distance. Both conditions are required.

### 3.1 Time + Minor Gate

| Tier | Minimum age before removal | Required minor lag |
| --- | ---: | ---: |
| alpha | 30 days | 1 minor |
| beta | 90 days | 2 minors |
| stable | 180 days | 3 minors |
| lts | 365 days | 4 minors |

If a row satisfies only one side of the gate, it remains blocked. For example, an API deprecated for 45 days in `beta` with 3 minors elapsed is still blocked because the 90 day window has not elapsed.

### 3.2 Deprecation Records

Every deprecation row must identify the surface, tier, deprecated date, deprecated framework version, removal target version, required minor lag, replacement, and current status. `docs/DEPRECATIONS.md` is intentionally conservative: a surface absent from the dashboard must not be treated as safe to remove.

## 4. Upgrade Safety

Safe upgrade commands are read-only until a reviewed plan is explicitly applied. Rollback evidence must be created before the first write.

### 4.5 Canary Upgrade Rollout

`atm upgrade apply --canary <percent>` applies only a deterministic subset of the files listed in the reviewed plan and writes an `atm.safeUpgradeCanaryState` record beside the backup manifest. Canary apply must always preserve rollback through the same `upgrade rollback --backup <backup-dir>` path.

## 9. Compatibility Matrix Review

Release tags must produce a compatibility matrix diff PR for human review. The PR may update `compatibility-matrix.json`, but the diff body and optional artifact must be machine-readable so downstream automation can decide whether the default chart, template, or support window changed.

## 11. Policy Self-Versioning

This file carries two frontmatter fields:

- `policy_version`: a major.minor policy schema version. Any policy contract change must bump this value before related docs are rewritten.
- `framework_version_range`: the framework release range this policy applies to.

Policy changes must follow this order:

1. Bump `policy_version` when the written policy contract changes.
2. Keep `framework_version_range` overlapping the active framework release train.
3. Update the validator or release workflow that enforces the policy.
4. Refresh README, CONTRIBUTING, and migration docs that teach contributors the new flow.

`scripts/validate-policy-self-version.ts` is the release gate for this section.