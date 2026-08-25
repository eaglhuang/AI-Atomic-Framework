# Atomic Registry Catalog

> Projection only. Source of truth remains `atomic-registry.json`.
> Generated from registry `registry.seed`.

## Atoms

| atomId | logicalName | function | derivedCategory | provenance | status | specPath |
| --- | --- | --- | --- | --- | --- | --- |
| `ATM-CORE-0001` | `atom.core-seed` | ATM Core Seed Self Descriptor: Canonical Atomic ID uses ATM-CORE-0001. The historical dot-notation name is preserved only as logicalName for human-readable namespace context. | `core / seed / self-descriptor` | `backfilled` | `active` | `specs/atom-seed-spec.json` |
| `ATM-CORE-0003` | `atom.plugin-rule-guard.neutrality-scanner` | Neutrality Scanner Atom: Deterministic scanner that blocks adopter-only references across protected framework surfaces. | `plugin / rule-guard / governance` | `backfilled` | `active` | `specs/neutrality-scanner.atom.json` |
| `ATM-CORE-0004` | `atom.core-atom-generator` | Atom Generator: Unified atom provisioning facade for allocating IDs, scaffolding workbench files, running validation, and registering atoms. | `core` | `bootstrap-self` | `active` | `atomic_workbench/atoms/ATM-CORE-0004/atom.spec.json` |
| `ATM-CORE-0005` | `atom.core-atomic-spec-semantic-fingerprint` | AtomicSpecSemanticFingerprint: Readable atom wrapper around packages/core/src/registry/semantic-fingerprint.ts#createAtomicSpecSemanticFingerprint. | `core` | `atomize` | `active` | `atomic_workbench/atoms/ATM-CORE-0005/atom.spec.json` |
| `ATM-CORE-0006` | `atom.npm-package.runtime-allowlist` | CLI package runtime allowlist resource: Owns the runtime package-file allowlist JSON pointer in packages/cli/package.json for brokered product delivery composition. | `generated / provisioning` | `generated` | `active` | `atomic_workbench/atoms/ATM-CORE-0006/atom.spec.json` |
| `ATM-CORE-0007` | `atom.npm-package.artifact-budget` | CLI package artifact budget resource: Owns the artifact budget JSON pointer in packages/cli/package.json for brokered product delivery composition. | `generated / provisioning` | `generated` | `active` | `atomic_workbench/atoms/ATM-CORE-0007/atom.spec.json` |
| `ATM-FIXTURE-0001` | `atom.fixture-generator-dogfood` | GeneratorDogfood: Proof that generator can produce a compliant atom. | `generated / provisioning` | `generated` | `active` | `atomic_workbench/atoms/ATM-FIXTURE-0001/atom.spec.json` |
| `ATM-GOV-0001` | `atom.work-coordination-authority-planning-source-seal` | PlanningSourceSealPolicy: Classify planning-source seal identity deltas as unchanged, benign seal upgrade, governed amendment, or blocking drift. | `generated / provisioning` | `generated` | `active` | `atomic_workbench/atoms/ATM-GOV-0001/atom.spec.json` |

## Maps

| mapId | memberCount | status | workbenchPath | notes |
| --- | --- | --- | --- | --- |
| `ATM-MAP-0001` | `2` | `draft` | `atomic_workbench/maps/ATM-MAP-0001` | provenance: generated |
| `ATM-MAP-0002` | `1` | `draft` | `atomic_workbench/maps/ATM-MAP-0002` | provenance: backfilled; lineage: atomic_workbench/maps/ATM-MAP-0002/lineage-log.json |
