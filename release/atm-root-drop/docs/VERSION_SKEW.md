# Version Skew Matrix

The version skew matrix is the release-time smoke contract for ATM's current CLI, Plugin SDK, and adapter surfaces.

## What It Checks

`scripts/skew-matrix.config.json` lists the supported combinations for the current release train. During alpha, the matrix is intentionally small: the current CLI version, the current Plugin SDK version, and the existing adapter baseline.

Each case runs three checks:

- `atm doctor --json` for the CLI surface.
- `validate-plugin-sdk.ts` for the Plugin SDK contract.
- The adapter-specific smoke validator for the selected adapter.

The current adapter baseline includes `adapter-local-git` plus the existing integration adapters for Claude Code, GitHub Copilot, Cursor, and Gemini.

## CI Behavior

`.github/workflows/version-skew-matrix.yml` runs on pull requests that touch release compatibility, skew config, CLI, Plugin SDK, or adapter files. The workflow writes `skew-output/skew-summary.json`, uploads it as the `version-skew-summary` artefact, and appends a compact case list to the GitHub Actions step summary.

If a pull request introduces an incompatible combination, `scripts/validate-skew-matrix.ts` exits non-zero. On PRs, the workflow comments with the failed case IDs and the failing smoke checks so reviewers do not need to dig through the whole log first.

## Updating The Matrix

Update `scripts/skew-matrix.config.json` when one of these changes:

- CLI package version changes.
- Plugin SDK package version changes.
- A supported adapter package changes version.
- `compatibility-matrix.json` changes the default framework/chart/template release train.

Keep `supportedMinorWindow` to at most two minor keys. This keeps CI fast while still proving the supported skew window described by the release policy.

## Local Commands

```bash
node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate
node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate --summary skew-output/skew-summary.json
node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate --config fixtures/skew/incompatible-version.config.json
```
