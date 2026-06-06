# Release Trust Continuous Verification

Tracked by TASK-ATD-0026.

The framework already ships three validators that protect the
release-trust surface:

| Validator | Script | What it gates |
|---|---|---|
| Version compatibility | `scripts/validate-version-compatibility.ts` | `releaseTrain.frameworkVersion` matches `package.json`, release tag matches matrix entry, `welcome --dry-run` reports the same version. |
| Known-bad versions | `scripts/validate-known-bad-versions.ts` | `known-bad-versions.json` schema, range syntax, no entry conflicts with the current release. |
| Release trust | `scripts/validate-release-trust.ts` | Release trust manifest signatures + integrity hashes. |

This card documents the **continuous verification recipe** that ties them
into a single ongoing gate, so drift in any one surface is caught the
same day it lands.

## What "continuous" means here

The three validators above already run inside `validate:standard`. This
card adds the **operational layer** around them:

1. **Pre-release ceremony.** Before any tag bump or release publish:
   ```bash
   npm run validate:standard       # includes all three
   npm run typecheck
   npm run lint
   ```
   If any of the three trust validators fail, no tag.

2. **Drift detection on main.** Each commit touching one of these paths
   triggers the trust validators:
   - `package.json` (any change → version-compatibility)
   - `compatibility-matrix.json` (any change → version-compatibility)
   - `known-bad-versions.json` (any change → known-bad)
   - `release/atm-onefile/**` (any change → release-trust)
   - `release/root-drop/**` (any change → release-trust)
   - `scripts/build-*-release.ts` (any change → both release-trust and
     version-compatibility)

3. **Cross-route check.** When the future release parity gate
   (TASK-ATD-0025) lands, it MUST run alongside the trust validators on
   every release-touching commit. Both reports persist to
   `.atm/history/reports/`.

## Per-validator continuous gates

### version-compatibility

- **Run on:** every commit, full `validate:standard`.
- **What it asserts:**
  - `compatibility-matrix.json.releaseTrain.frameworkVersion` ===
    `package.json.version`.
  - For each `releaseTag`, the matrix's framework version matches.
  - `welcome --dry-run` reports the same version (live smoke).
- **Failure means:** the matrix is out of sync with the published version.
  The fix is always to regenerate the matrix via
  `scripts/generate-matrix-pr.ts`.

### known-bad-versions

- **Run on:** every commit, full `validate:standard`.
- **What it asserts:** every entry in `known-bad-versions.json` has a
  valid semver range, severity, and replacement version. No entry pins
  the current framework version as known-bad.
- **Failure means:** a malformed entry was committed OR the current
  release accidentally matches a known-bad range. Either fix the entry or
  bump the framework version to escape the range.

### release-trust

- **Run on:** every commit touching `release/**` or
  `scripts/build-*-release.ts`.
- **What it asserts:** the trust manifest's signatures and content hashes
  match what the build process actually produced.
- **Failure means:** either the build was non-deterministic (rebuild and
  diff) or the manifest was edited by hand (regenerate via the build
  script).

## Release ceremony checklist

Before tagging `v0.X.Y`:

- [ ] `npm run validate:standard` green (53/53 or current baseline).
- [ ] `npm run validate:cli` green.
- [ ] `npm run typecheck` green (or only pre-existing errors that don't
      mention `release/` or `scripts/build-`).
- [ ] `package.json.version`, `compatibility-matrix.json.releaseTrain.frameworkVersion`,
      and `welcome --dry-run` output agree.
- [ ] No `known-bad-versions.json` entry shadows the candidate version.
- [ ] `release/atm-onefile/atm.mjs` rebuilds to byte-identical artifact.
- [ ] `release/root-drop/**` rebuilds to byte-identical artifact.
- [ ] (Future) release-parity gate green for source / root-drop / onefile.

If any item fails, **do not tag** — open a card to fix the underlying
contract before promoting.

## Manifest snapshots for drift detection

Each release should snapshot:

- `release/atm-onefile/atm.mjs` SHA-256.
- `release/root-drop/manifest.json` content hash.
- `compatibility-matrix.json` content hash.
- `known-bad-versions.json` content hash.

The snapshot file at `.atm/history/reports/release-trust/<version>.json`
becomes the next release's drift baseline.

## Invariant exposure

- **I6** (version source consistency) — the version-compatibility
  validator is the gate.
- **I3** (release artifact deterministic build) — the release-trust
  validator is the gate.
- **I1** (public CLI surface stable) — the `welcome --dry-run` smoke
  inside version-compatibility transitively gates I1.

## Related

- [`docs/release-parity-gate.md`](./release-parity-gate.md) — the parity
  gate that complements these three validators.
- [`docs/cli-error-policy.md`](./cli-error-policy.md) — the error envelope
  these validators all use.
- [`docs/testing-strategy.md`](./testing-strategy.md) — these validators
  sit in the `validator` layer.
