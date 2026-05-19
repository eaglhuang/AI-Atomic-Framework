# `upgrade.ts` Split Plan

Status: **planned (not yet implemented)**.
Tracked by TASK-ATD-0016.

## Current state

`packages/cli/src/commands/upgrade.ts` is 1231 lines and exposes a single
public entry point (`runUpgrade`) that fans out across:

- Experimental API gating (~70 lines): `firstExperimentalUpgradeAction`,
  `parseExperimentalApiOptions`, `runUpgradeExperimentalApi`.
- Safe-upgrade plan/apply/rollback (~250 lines): `firstSafeUpgradeAction`,
  `parseSafeUpgradeOptions`, `runSafeUpgradePlan`, `runSafeUpgradeApply`,
  `runSafeUpgradeRollback`.
- Canary selection helpers (~50 lines): `parseCanaryPercent`,
  `resolveCanarySelection`, `shouldApplyUpgradeFile`.
- Safe-upgrade file collection / backup (~120 lines):
  `collectSafeUpgradeFiles`, `addManifestFiles`,
  `extractManagedFilesFromManifest`, `addBackupRecord`,
  `backupSafeUpgradeFiles`.
- Path / hash utilities (~40 lines): `safeReadJson`, `sha256File`,
  `resolveRepositoryPath`, `normalizeRepositoryRelativePath`.
- Next-action hint builder (~45 lines): `buildUpgradeNextActionHint`.
- Scan / proposal flow (~300 lines): `runUpgradeScan`,
  `parseUpgradeOptions`, `isGuidedLegacyDryRun`,
  `runGuidedLegacyDryRunProposal`, `enqueueGuidedLegacyProposal`,
  `loadExplicitInputDocuments`, `normalizeUpgradeInputDocument`,
  `discoverInputDocuments`.

## Target submodule layout

```
packages/cli/src/commands/upgrade.ts          (entry + arg routing, ~120 lines)
packages/cli/src/commands/upgrade/
├── safe-upgrade/
│   ├── plan.ts              # runSafeUpgradePlan + helpers
│   ├── apply.ts             # runSafeUpgradeApply + backup + canary
│   ├── rollback.ts          # runSafeUpgradeRollback
│   ├── canary.ts            # parseCanaryPercent, resolveCanarySelection
│   └── collect.ts           # collectSafeUpgradeFiles + manifest helpers
├── scan.ts                  # runUpgradeScan + input discovery
├── proposal.ts              # parseUpgradeOptions + guided legacy proposal
├── experimental.ts          # experimental API gating
├── next-action-hint.ts      # buildUpgradeNextActionHint
└── path-helpers.ts          # safeReadJson, sha256File, normalize paths
```

The top-level `upgrade.ts` retains `runUpgrade` and the dispatch logic only.
Every helper is re-exported under its original name from the submodule files,
and `upgrade.ts` imports them — so no external caller breaks.

## Acceptance gates

A real split lands only when ALL of the following pass:

1. `npm run validate:cli` — the CLI fixture exit codes and message codes
   under `tests/cli-fixtures/` are unchanged.
2. `npm run validate:standard` — full standard suite green (53/53).
3. `npm run typecheck` — no new errors in `packages/cli/`.
4. The `upgrade` JSON envelope shape is byte-identical for each action
   (verified by spawning `node atm.mjs upgrade <action> --json` against a
   sentinel fixture and diffing the output).

## Why this is deferred

This card was opened during a session where the working tree had unrelated
pre-existing merge conflicts in `packages/plugin-sdk/` that broke 5 skew
smoke validators. Performing a 1200-line restructure on top of a broken
baseline would make root-cause analysis of any new failure impossible. The
split is staged here so a future card can land it cleanly once the baseline
is green.

## Invariant exposure

- **I1** (public CLI surface stable): every action keeps its current code
  surface and JSON shape. The split is purely internal restructuring.
- The risk is in `runSafeUpgradeApply` (writes files + records evidence). A
  before/after diff of the evidence path is required as part of the gate.
