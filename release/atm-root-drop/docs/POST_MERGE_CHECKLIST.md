# Post-Merge Health Checklist (Main Branch)

Use this checklist after merging into `main` to quickly confirm ATM governance
and runtime integrity are still healthy.

## Preconditions

Before running checks, confirm:

- You are on the latest `main`.
- Local dependencies are installed and consistent.
- `atm.mjs` and release wrappers are present in the repository.

## One-Command Health Check

```bash
node --experimental-strip-types scripts/check-main-health.ts
```

## Manual 4-Step Verification

Run these commands in order:

1. `git switch main && git pull --ff-only origin main`
2. `npm ci`
3. `npm run validate:standard`
4. `npm test && node atm.mjs verify --neutrality --json && node atm.mjs verify --agents-md --json`

## If Any Check Fails

- Do not merge additional PRs into `main` until checks are green again.
- Treat failures as governance regressions first, then investigate feature-level changes.
- Capture failing output and link it in the incident/repair PR for traceability.
