# Long-Tail User Safeguards

ATM treats older adopter repositories as diagnosable first, mutable second. When a local project is behind, unknown, offline, or opened with an older CLI than it has previously seen, write-oriented onboarding flows fail closed until the user explicitly asks for a reviewed upgrade path.

## Active And Legacy Matrices

`compatibility-matrix.json` is the active release-train matrix. It contains currently supported chart and template versions.

`compatibility-matrix.legacy.json` is append-only historical evidence for unsupported versions. The CLI loads both files and merges them for diagnostics, so an old offline project can still learn that its chart is unsupported and which migration path to review.

Unsupported entries should move to the legacy matrix instead of being physically deleted. Each legacy entry records `removedFromActiveSupportAt`, `reason`, and a migration guide hint.

## Offline First Touch

If the compatibility matrix file cannot be read, the CLI falls back to a bundled snapshot. `doctor --json` emits `ATM_COMPATIBILITY_BUNDLED_SNAPSHOT` with the snapshot `lastUpdated` value, but it continues in read-only diagnostic mode when the local chart is otherwise supported.

## Downgrade Detection

When a repository has an `.atm` directory, ATM records the highest framework version seen in `.atm/runtime/version-cache.json`. If a later CLI run sees a lower framework version than the cached value, `doctor` emits `ATM_FRAMEWORK_DOWNGRADE_DETECTED` and the version compatibility report becomes read-only. This prevents an older CLI from rewriting onboarding files produced by a newer release.

## Unknown Chart Override

Unknown chart versions fail closed for upgrade planning. The default command refuses to prepare follow-up write steps:

```bash
node atm.mjs upgrade plan --json
```

A user can still request a dry-run plan after acknowledging the unknown chart state:

```bash
node atm.mjs upgrade plan --allow-unknown-chart --json
```

The plan remains dry-run output. Applying it still requires the normal explicit `upgrade apply --from-plan <plan.json>` path.
