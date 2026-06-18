# Build / Release Output Hygiene

ATM release mirrors under `release/atm-onefile/` and `release/atm-root-drop/` are
generated artifacts. They are gitignored broadly, but a small set of tracked
manifests and the one-file runner can still show up as confusing worktree dirt
after an accidental full build.

## Default behavior

- `npm run build:packages` — compile TypeScript and refresh `packages/cli/dist`
  without touching release mirrors. Prefer this during ordinary validator runs.
- `npm run build` — full runner-sync chain. By default it **restores tracked
  release manifests to `HEAD`** after `build-onefile-release` completes so
  casual builds do not leave mirror dirt behind.

## Retain generated release outputs

When you intentionally publish runner-sync artifacts, set:

```bash
ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build
```

This keeps the generated `release/**` outputs in the worktree for a governed
delivery commit.

## Cleanup after accidental builds

```bash
npm run build:release-hygiene:cleanup
```

Or restore only the tracked manifests:

```bash
git restore -- release/atm-onefile/atm.mjs release/atm-onefile/release-manifest.json release/atm-root-drop/release-manifest.json
```

## Policy surface

`node --strip-types scripts/build-release-hygiene.ts --mode policy --json`
