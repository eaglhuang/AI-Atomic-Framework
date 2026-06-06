# Atom Space Layout

ATM keeps one canonical workspace folder per atom. The folder name must equal the Atomic ID exactly. ATM does not create a second sanitized alias folder for the same atom.

Atomic Maps follow the same rule as a sibling surface: one canonical folder per `mapId`, no alternate alias workbench, no parallel "legacy but still active" home.

## Canonical Layout

Default per-atom workspace layout:

```text
atomic_workbench/atoms/<atomId>/
  atom.spec.json
  atom.test.ts
  atom.test.report.json
```

Default per-map workspace layout:

```text
atomic_workbench/maps/<mapId>/
  map.spec.json
  map.integration.test.ts
  map.test.report.json
```

Rules:

- `<atomId>` is the Atomic ID string exactly as declared in the spec.
- `<mapId>` is the canonical `ATM-MAP-{NNNN}` identifier exactly as declared in the map spec.
- Path separators are forbidden inside the Atomic ID when resolving the canonical folder name.
- Dots and hyphens are preserved; they are part of the canonical folder name, not a value that should be normalized away.
- `packages/core/src/manager/atom-space.mjs` is the single source of truth for default atom workbench, scaffold, and report paths.
- `packages/core/src/manager/map-generator.mjs` is the single source of truth for default map workbench, spec, integration test, and report paths.

## Contract Surface

The canonical atom-space contract applies to these flows:

- scaffold builder: default spec and test files are created under the canonical `<atomId>` folder.
- delegated test runner: default machine-readable test report is written under the same canonical folder.
- registry builder: `location.workbenchPath` resolves to the canonical atom folder when no explicit override is supplied.

The canonical map-space contract applies to the sibling flows:

- map generator: default map spec, integration test, and test report are written under the canonical `<mapId>` folder.
- map integration runner: canonical discovery starts at `atomic_workbench/maps/<mapId>/` before any legacy fallback.
- registry builder: map `location.workbenchPath` resolves to the canonical map folder when no explicit override is supplied.

Adapters may still supply explicit `workbenchPath` or `reportPath` overrides when a host layout requires it. Those overrides are opt-in exceptions. The default path must remain the canonical per-atom layout above.

## Migration Policy

ATM-2-0013 does not require every historical atom source file to move immediately. Migration is staged:

1. New atoms must scaffold into the canonical `<atomId>` folder by default.
2. New default test reports must land in the canonical `<atomId>` folder.
3. Existing scattered source files may remain temporarily, but registry `sourcePaths` must continue to point to the real source-of-record paths.
4. When an existing atom is migrated, its destination folder must be the Atomic ID exactly. Do not introduce parallel alias folders.
5. If a host needs a non-default layout, that exception must come from an explicit adapter override, not from silently changing the core default.
6. Empty `atomic_workbench/atoms/atom.*` directories are treated as stale local migration residue, not compatibility aliases. Remove them instead of preserving them as parallel workbench homes.

Map migration uses the same posture:

1. New maps must birth into `atomic_workbench/maps/<mapId>/` by default.
2. Historical local maps may survive as archived lineage witnesses, but they must not remain the active canonical workbench once a canonical `ATM-MAP-{NNNN}` exists.
3. Backfilled maps keep the archived source as evidence, while the registry points at the canonical trio under `atomic_workbench/maps/<mapId>/`.

This policy keeps the migration reversible while still stopping further growth of scattered atom components.
