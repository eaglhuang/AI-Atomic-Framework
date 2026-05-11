# Atomic Registry Catalog

> Projection only. Source of truth remains `atomic-registry.json`.
> Generated from registry `registry.seed`.

## Atoms

| atomId | logicalName | function | derivedCategory | provenance | status | specPath |
| --- | --- | --- | --- | --- | --- | --- |
| `ATM-CORE-0001` | `atom.core-seed` | ATM Core Seed Self Descriptor: Canonical Atomic ID uses ATM-CORE-0001. The historical dot-notation name is preserved only as logicalName for human-readable namespace context. | `core / seed / self-descriptor` | `backfilled` | `active` | `specs/atom-seed-spec.json` |
| `ATM-CORE-0003` | `atom.plugin-rule-guard.neutrality-scanner` | Neutrality Scanner Atom: Deterministic scanner that blocks adopter-only references across protected framework surfaces. | `plugin / rule-guard / governance` | `backfilled` | `active` | `specs/neutrality-scanner.atom.json` |
| `ATM-CORE-0004` | `atom.core-atom-generator` | Atom Generator: Unified atom provisioning facade for allocating IDs, scaffolding workbench files, running validation, and registering atoms. | `core` | `bootstrap-self` | `active` | `atomic_workbench/atoms/ATM-CORE-0004/atom.spec.json` |
| `ATM-CORE-0005` | `atom.html-to-ucuf.normalize-css-color` | Normalize CSS Color Atom: Normalize CSS color strings to canonical #RRGGBBAA hex for the first html-to-ucuf case atom. | `alpha0 / html-to-ucuf` | `atomize` | `active` | `specs/normalize-css-color.atom.json` |
| `ATM-CORE-0006` | `atom.html-to-ucuf.parse-css-length` | Parse CSS Length Atom: Parse CSS px length text into numeric values for html-to-ucuf snapshot pipeline. | `alpha1 / html-to-ucuf` | `atomize` | `active` | `specs/parse-css-length.atom.json` |
| `ATM-CORE-0007` | `atom.html-to-ucuf.parse-fragment-list` | Parse Fragment List Atom: Parse comma-separated fragment tokens into normalized fragment arrays. | `alpha1 / html-to-ucuf` | `atomize` | `active` | `specs/parse-fragment-list.atom.json` |
| `ATM-FIXTURE-0001` | `atom.fixture-generator-dogfood` | GeneratorDogfood: Proof that generator can produce a compliant atom. | `generated / provisioning` | `generated` | `active` | `atomic_workbench/atoms/ATM-FIXTURE-0001/atom.spec.json` |

## Maps

| mapId | memberCount | status | workbenchPath | notes |
| --- | --- | --- | --- | --- |
| `ATM-MAP-0001` | `2` | `draft` | `atomic_workbench/maps/ATM-MAP-0001` | provenance: generated |
| `ATM-MAP-0002` | `1` | `draft` | `atomic_workbench/maps/ATM-MAP-0002` | provenance: backfilled; lineage: atomic_workbench/maps/ATM-MAP-0002/lineage-log.json |
| `ATM-MAP-0003` | `3` | `draft` | `atomic_workbench/maps/ATM-MAP-0003` | provenance: generated |
