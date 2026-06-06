# `integrations-core` Split Plan (compiler / manifest / verify)

Status: **planned (not yet implemented)**.
Tracked by TASK-ATD-0021.

## Current state

`packages/integrations-core/src/index.ts` is 696 lines and a single file
holding three distinct concerns:

### 1. Skill template compiler (~330 lines, lines 1–333)

- Package identity constant (`integrationsCorePackage`).
- ID / format / placeholder type aliases.
- Minimum-entry skill definitions (the 8 baseline skill names).
- Template loader: `parseSkillTemplate`, `loadSkillTemplates`,
  `loadMinimumAtmSkillTemplates`.
- Compiler: `compileSkillTemplatesForAdapter`, `compileSkillTemplate`.
- Charter renderer: `renderCharterInvariantsBlock`.

### 2. Install manifest model (~120 lines, lines 403–520)

- Schema constants: `installManifestSchemaVersion`.
- Types: `IntegrationInstallContext`, `IntegrationSourceFile`,
  `InstallManifest{,File}`, `CreateInstallManifestInput`.
- Manifest construction helpers.

### 3. Verify + uninstall safety (~150 lines, lines 521–696)

- Finding type aliases: `IntegrationFindingLevel`, `IntegrationFindingCode`.
- Verify helpers (file hash compare, drift report).
- Uninstall safety helpers (preserve-if-modified semantics).

## Target submodule layout

```
packages/integrations-core/src/index.ts          (re-export aggregator, ~80 lines)
packages/integrations-core/src/
├── compiler/
│   ├── skill-templates.ts        # parse/load + minimum templates
│   ├── compile.ts                # compileSkillTemplatesForAdapter + compileSkillTemplate
│   └── charter-block.ts          # renderCharterInvariantsBlock
├── manifest/
│   ├── types.ts                  # IntegrationInstallContext + InstallManifest* types
│   ├── schema.ts                 # installManifestSchemaVersion + validators
│   └── construct.ts              # createInstallManifest + helpers
└── verify/
    ├── types.ts                  # IntegrationFinding* aliases
    ├── verify-installed.ts       # hash compare + drift report
    └── uninstall-safety.ts       # preserve-if-modified + safe-removal
```

Top-level `index.ts` keeps:
- Package identity constant.
- Adapter id / format aliases (referenced by both compiler and manifest).
- Re-exports from every submodule under the existing public names.

## Acceptance gates

1. `npm run validate:integration-adapter` — installed integration manifests
   must still parse identically.
2. `npm run validate:governance-local` — the plugin-governance-local
   bootstrap flow consumes integrations-core; the bootstrap output must
   stay byte-identical.
3. `npm run validate:standard` — full suite green.
4. `tests/agent-pack/install-uninstall-roundtrip.test.ts` — install +
   verify + uninstall roundtrip must produce the same hash trail.
5. Manifest hash regression fixture: a known synthetic install must produce
   the exact same SHA-256 of its manifest payload before and after the
   split.

## Invariant exposure

- **I5** (manifest hash stability): the `.atm/integrations/<id>.manifest.json`
  schema and the hashes recorded inside it are public contract. Any field
  rename or reorder breaks adopter sandboxes. The split is purely organizational
  — no field changes, no reordering, no semantic change.

## Why deferred (working tree state)

This session opened with pre-existing merge conflicts in
`packages/plugin-sdk/src/*` that broke 5 skew smoke validators. The
integrations-core split touches a contract surface (I5) where the gate is
manifest hash equality. Performing the split on a broken baseline makes
"did the hash change because of the split, or because of the baseline?"
unanswerable.

The plan staged here can be executed in one focused PR once the baseline
is clean. Expected diff: +9 files under `compiler/`, `manifest/`, `verify/`,
~+750 lines total, ~-620 lines from `index.ts`, net neutral on LOC.

## Order of operations for the future card

1. Create the three submodule directories with empty re-export stubs.
2. Move compiler helpers first (no callers outside `index.ts`).
3. Run `validate:integration-adapter` → confirm green.
4. Move manifest types + constructor.
5. Run `validate:integration-adapter` + `tests/agent-pack/*` → confirm
   manifest hashes unchanged.
6. Move verify + uninstall safety.
7. Run full `validate:standard` → confirm 53/53.
8. Final check: a release-trust fixture must produce the same hash trail.
