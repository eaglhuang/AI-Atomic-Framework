# ATM atom birth reliability report

## Scope

TASK-PRF-0065 repairs the existing `atom.core-atom-generator` birth path. It does not change npm packaging, bundling, or prior PRF-0059/0064 evidence.

## Original failure

The 2026-09-14 PRF-0064 attempt generated atom files before validating the candidate registry. The failed validation left generated files behind, and the registry entry captured a temporary bundled schema path with a zero hash lock. The failure was recorded in `C:\Users\User\atm-benchmark-sink\TASK-PRF-0064\reviews\TASK-PRF-0064-ATOM-BIRTH-FAILURE-01.json`.

## Repair

- `createMinimalAtomSpec()` now computes the `sha256`/`json-stable-v1` digest over canonical JSON with `hashLock.digest` excluded, so generated specs never contain a placeholder digest.
- `normalizeSchemaPath()` maps schemas resolved from a frozen package back to the portable `schemas/...` contract and never records the package's temporary absolute path when the schema suffix is recognizable.
- `generateAtom()` snapshots the target workbench, registry, and catalog before mutation. Any scaffold, test, registry write, or final validation failure restores the exact previous bytes and removes newly-created files.
- Candidate registry validation runs in memory before registry artifacts are written.
- `ATM-CORE-0004` self-verification hashes and the generator provenance audit were refreshed to reflect the repaired source.

## Evidence

- `node --strip-types tests/core/atom-generator.test.ts` — PASS. Covers dry-run, successful birth, non-placeholder digest, portable schema path, idempotent rerun, and injected source failure with zero residue.
- `node --strip-types tests/registry/registry-entry-portability.test.ts` — PASS. Covers frozen-bundle schema path normalization and source hash shape.
- `node --strip-types scripts/validate-generator-provenance.ts --mode validate` — PASS.
- `node --strip-types scripts/validate-registry-core.ts --mode validate` — PASS.
- `npm run typecheck` and the touched-file encoding guard — PASS.

## Acceptance disposition

ACC1–ACC5 are supported by the command-backed evidence above. A successful logical rerun remains idempotent; a failed birth leaves pre-existing bytes unchanged and does not add a new atom directory. Publication, bundler splitting, and push remain explicitly out of scope.
