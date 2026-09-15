# Evidence Ledger boundary baseline (TASK-PRF-0098)

Observed 2026-09-15 before implementation. This is a source and runtime
baseline; it does not claim that historical Git evidence was reduced.

## Current ownership map

| Surface | Current writer | Current reader | Retention |
| --- | --- | --- | --- |
| Runtime ledger records/indexes | `createLocalGovernanceStores().evidenceStore.appendEvidence` in `packages/plugin-governance-local/src/stores.ts` | the same store (`resolveEvidence`, `listEvidence`, `checkpointEvidence`) | ignored runtime state |
| Runtime task evidence envelope | `writeEvidenceEnvelope` in `packages/cli/src/commands/evidence/bundle-io/implementation.ts` (used by `evidence add` and historical-batch paths) | `readEvidenceBundle` in `packages/cli/src/commands/evidence/evidence-store.ts` | ignored runtime state; legacy read fallback retained |
| Durable bundle manifest | `writeEvidenceBundleManifest` in `bundle-io/implementation.ts` | `readEvidenceBundleManifest` in the same implementation | tracked close projection |
| Legacy task envelope | no new writer is authorized; compatibility writers/readers remain in explicitly approved migration/close paths | `readEvidenceBundle` and migration code | historical Git evidence |

The first two runtime surfaces carry overlapping task evidence semantics but
are not interchangeable: the ledger is content-addressed and immutable, while
the task envelope supports ordered historical-batch removal. The durable
manifest is a compact close projection and is intentionally retained.

## Measured baseline

- `node --strip-types tests/cli/runtime-evidence-git-boundary.test.ts` — PASS.
- `node --strip-types tests/cli/evidence-ledger-migration.test.ts` — PASS.
- `node --strip-types scripts/validate-evidence-ledger-boundary.ts` — PASS;
  5,752 ledger records, checkpoint
  `sha256:a476361a681d91a73d8962cd345831ccd875a2122bd119a19e05efed65cc6785`,
  978 production files scanned.
- `npm run typecheck` — PASS.
- `implementation.ts` is 94,892 bytes and contains five envelope-writer
  call-sites plus six direct `writeFileSync` occurrences. The separately
  extracted `manifest-reader.ts` is 2,343 bytes, while the implementation
  still contains its own manifest reader/path implementation. This is a
  verified duplicate production module, not a second authoritative store.

## Bounded reduction and stop rule

The first safe reduction removes two unused manifest-path helpers from
`evidence-store.ts`; the canonical manifest path implementation remains in
`bundle-io/implementation.ts`, and the bounded extraction module remains
covered by its existing extraction test. This is a small production-code
deletion and does not alter any persisted path.

The stronger storage reduction (removing either the task envelope or the
content-addressed ledger) is intentionally stopped in this card. The current
historical-batch remove/replay flow still depends on the envelope, while the
ledger is the tamper-verifiable authority. Removing either without a replay
adapter would violate ACC-1/ACC-3 and could erase deviation history. Therefore
ACC-2's storage-representation portion remains unmet and must not be reported
as completed; a later bounded card may address it only with replay, tamper and
concurrency evidence.
