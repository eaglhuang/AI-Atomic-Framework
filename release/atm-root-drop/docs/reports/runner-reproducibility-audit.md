# Runner Reproducibility Audit

Generated for `TASK-MAO-0011`.

## Scope

Byte-compared runner artifacts:

- `release/atm-onefile/atm.mjs`
- `release/atm-onefile/release-manifest.json`
- `release/atm-root-drop/release-manifest.json`

## Finding

The previous build path wrote wall-clock `generatedAt` values into root-drop and onefile release manifests. The onefile manifest also copied that timestamp from the embedded payload, which made consecutive builds differ even when source files did not change.

## Remediation

`scripts/build-root-drop-release.ts` and `scripts/build-onefile-release.ts` now default `generatedAt` to `1970-01-01T00:00:00.000Z` for byte-reproducible generated artifacts. Operators can still provide provenance explicitly through `ATM_RELEASE_GENERATED_AT` or `SOURCE_DATE_EPOCH`.

## Gate

`npm run validate:runner-reproducibility` runs two consecutive temp builds and compares the byte hash of the runner artifacts above. The gate also asserts the default manifest timestamp is deterministic.
