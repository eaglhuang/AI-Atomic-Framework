# Atom Generator

`AtomGenerator` is the alpha0 provisioning facade for creating new atoms. `AtomicMapGenerator` is its map-level sibling for birthing governed Atomic Maps. Together they turn atom/map birth from a loose sequence of primitive calls into governed entrypoints:

```text
atm create -> generateAtom() -> allocateAtomId() -> scaffoldAtomWorkbench() -> runAtomicTestRunner() -> createAtomicRegistryEntry() -> writeRegistryArtifacts()
atm create-map -> generateAtomicMap() -> allocateMapId() -> write map workbench files -> run map integration self-check -> createAtomicMapRegistryEntry() -> writeRegistryArtifacts()
```

## Responsibilities

- Allocate canonical IDs with `ATM-{BUCKET}-{NNNN}` format.
- Allocate canonical map IDs with `ATM-MAP-{NNNN}` format.
- Initialize a minimal valid Atomic Spec.
- Initialize a minimal valid Atomic Map spec.
- Delegate workbench file creation to the existing scaffold builder.
- Run the declared validation command through the existing test runner.
- Register the atom in `atomic-registry.json` and refresh the registry catalog.

For maps, the generator also computes canonical `mapHash` and `semanticFingerprint`, writes the canonical map workbench, runs the generated integration self-check, registers the map entry, and refreshes the same catalog/provenance surfaces as atom birth.

The generators are intentionally facades. They do not redefine the parser, atom-space layout, scaffold builder, hash-lock, or registry semantics.

## API

```js
import { generateAtom } from './packages/core/src/manager/atom-generator.ts';

const result = generateAtom({
  bucket: 'FIXTURE',
  title: 'Example Atom',
  description: 'Proof atom generated through the provisioning facade.',
  logicalName: 'atom.fixture-example'
});
```

The result includes `atomId`, `workbenchPath`, `specPath`, `sourcePath`, `testPath`, `allocation`, and per-phase execution records. Repeating the same `logicalName` is idempotent and returns the existing registry entry.

## Atomic Map API

```js
import { generateAtomicMap } from './packages/core/src/manager/map-generator.ts';

const result = generateAtomicMap({
  members: [
    { atomId: 'ATM-CORE-0004', version: '0.1.0' },
    { atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }
  ],
  edges: [
    { from: 'ATM-CORE-0004', to: 'ATM-FIXTURE-0001', binding: 'generates' }
  ],
  entrypoints: ['ATM-CORE-0004'],
  qualityTargets: {
    requiredChecks: 2,
    promoteGateRequired: true
  }
});
```

The result includes `mapId`, `workbenchPath`, `specPath`, `testPath`, `reportPath`, `allocation`, and per-phase execution records. Repeating the same member/edge/entrypoint/quality-target combination is idempotent and returns the existing registry entry.

Generated atoms now use a four-file workbench shape:

```text
atomic_workbench/atoms/<atomId>/
  atom.spec.json
  atom.source.mjs
  atom.test.ts
  atom.test.report.json
```

The source file is the default registry `codePaths` target, and the generated spec validates it with `node "atomic_workbench/atoms/<atomId>/atom.source.mjs" --self-check`. This keeps generated atoms from falling back to spec-as-code.

Generated maps now use a three-file workbench shape:

```text
atomic_workbench/maps/<mapId>/
  map.spec.json
  map.integration.test.ts
  map.test.report.json
```

The canonical map ID is `ATM-MAP-{NNNN}`. Historical `map.*` names may still appear in legacy fixture labels or human-readable descriptions, but they are no longer valid canonical registry identifiers.

Maps inherit the same "generator owns the canonical birth layout" rule as atoms:

- `map.spec.json` is the source-of-record spec written by `generateAtomicMap()`.
- `map.integration.test.ts` is the default validation command contract for generated maps. The default command is `node atomic_workbench/maps/<mapId>/map.integration.test.ts`.
- `map.test.report.json` is the replayable self-check result produced by that default command.
- rerunning `generateAtomicMap()` with the same member/edge/entrypoint/quality-target request is idempotent. The generator must return the existing `mapId` and canonical trio instead of allocating a second workbench.

This keeps map birth aligned with atom birth: one canonical workbench, one default validation contract, one registry projection surface.

## CLI

```bash
node atm.mjs create \
  --bucket FIXTURE \
  --title ExampleAtom \
  --description "Proof atom generated through the provisioning facade." \
  --logical-name atom.fixture-example
```

Use `--dry-run` to preview allocation and planned files without writing to disk.

## Discovery Channels

`atm create` is the canonical birth command, but agents may enter the repository through different routes.

- Task-driven host repo: use the host router or task wrapper first, but it should still terminate at `ATM-CORE-0004` / `atm create`.
- No task card or ad-hoc framework work: run `node atm.mjs guide create-atom`.
- ATM not initialized yet in the target repo: run `node atm.mjs guide bootstrap` first.

The important rule is that task cards are one discovery channel, not the only discovery channel. The canonical provisioning path still lives in the generator.

## Atomic Map CLI

```bash
node atm.mjs create-map \
  --members '[{"atomId":"ATM-CORE-0004","version":"0.1.0"},{"atomId":"ATM-FIXTURE-0001","version":"0.1.0"}]' \
  --edges '[{"from":"ATM-CORE-0004","to":"ATM-FIXTURE-0001","binding":"generates"}]' \
  --entrypoints '["ATM-CORE-0004"]' \
  --quality-targets '{"requiredChecks":2,"promoteGateRequired":true}'
```

Use `--dry-run` here as well to preview `mapId`, workbench paths, and registry effects without writing to disk.

## Self Governance

The generator itself is registered as `ATM-CORE-0004` with logicalName `atom.core-atom-generator`.

```text
atomic_workbench/atoms/ATM-CORE-0004/
  atom.spec.json
  atom.test.ts
  atom.test.report.json
```

This keeps the provisioning facade under the same registry, hash-lock, and evidence rules as the atoms it creates. The CLI command is only a host facade; the core behavior lives in `packages/core/src/manager/atom-generator.ts` and `packages/core/src/manager/id-allocator.ts`.

## Dogfood Evidence

`ATM-FIXTURE-0001` was generated by `atm create` as dogfood evidence. It proves the alpha0 generator can allocate an ID, scaffold a workbench, create a real source file, run validation, register the entry, and refresh the catalog.

`ATM-MAP-0001` is the first dogfood Atomic Map born through `generateAtomicMap()` / `atm create-map`. It proves the framework can allocate a canonical map ID, write `atomic_workbench/maps/<mapId>/`, generate `mapHash` / `semanticFingerprint`, register the map entry, refresh the catalog, and satisfy map-aware provenance checks.

## Provenance Backfill

Pre-generator entries keep their original atom IDs and source-of-truth paths. The backfill process adds generator provenance evidence, creates canonical workbench witness files, refreshes test reports, and keeps registry hash-locks aligned with the real source paths.

```bash
node --experimental-strip-types scripts/backfill-generator-provenance.ts
```

The current registry classifies entries as:

- `backfilled`: historical atoms that now have generator provenance witnesses (`ATM-CORE-0001`, `ATM-CORE-0003`).
- `bootstrap-self`: the generator atom created during the self-bootstrap step (`ATM-CORE-0004`).
- `generated`: atoms or maps born through the provisioning facades (`ATM-FIXTURE-0001`, `ATM-MAP-0001`).

Legacy maps follow the same rule after migration. The backfill path allocates a fresh canonical `ATM-MAP-{NNNN}` identifier, writes the canonical trio under `atomic_workbench/maps/<mapId>/`, preserves the old local map as archived lineage evidence, and marks the registry entry with `generator-provenance:backfilled`.

The catalog shows this in its `provenance` column.

## Provenance Audit

The provenance audit is deterministic and committed as `atomic_workbench/generator-provenance-audit.json`.

```bash
node --experimental-strip-types scripts/validate-generator-provenance.ts --write
npm run validate:generator-provenance
```

Validation fails if a registry entry has no generator provenance marker, if a generated atom points `codePaths` at its spec, if a backfilled atom is missing its workbench witness files, or if any registry entry has hash drift.

For maps, the same audit derives canonical map workbench paths, checks `map.spec.json` / `map.integration.test.ts`, and compares the registry entry against the generated map spec instead of atom `selfVerification` hashes.

Map template policy also has its own deterministic gate:

```bash
node --experimental-strip-types scripts/validate-map-template.ts --mode validate
npm run validate:map-template
```

The validator proves the generator writes the canonical trio, keeps the dry-run and write-mode paths aligned, records map `location` / `evidence` metadata in the registry, and preserves idempotent reruns.

## Alpha0 Limits

- Sequence allocation is registry-based max+1; it does not use a reservation file yet.
- The current backfill path preserves existing atom IDs and source paths; full evolution semantics remain an alpha1 topic.
- `create-map` currently expects JSON-encoded `members`, `edges`, `entrypoints`, and `qualityTargets` arguments; a friendlier file/recipe input mode remains future work.
