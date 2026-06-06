---
name: atm-legacy-atomization-guidance
description: Legacy compatibility alias for ATM legacy atomization, split, infect, and migration work. Prefer atm-governance-router for new installs.
argument-hint: "<natural language goal>"
---

# ATM Legacy Atomization Guidance

This compatibility skill preserves the older legacy atomization entry name while
keeping its trigger surface adopter-neutral and English-only. New installations
should prefer `atm-governance-router`.

## Required First Step

Before reading host task docs to choose a behavior, run:

```bash
node atm.mjs guide --goal "<natural language goal>" --cwd . --json
```

If the host exposes an `atm` wrapper, the equivalent entrypoint is
`atm guide --goal "<natural language goal>"`.

If the result reports `matchedIntent: "legacy-atomization"`, follow only the
guided route below.

## Guided Route

1. Run `node atm.mjs orient --cwd . --json`.
2. Run the `nextCommand` returned by `guide`; it should be an
   `atm start --legacy-flow` command.
3. Run `node atm.mjs next --cwd . --json`.
4. Execute exactly the single dry-run proposal command returned by `next`.
5. Stop for human review before any apply or host mutation.
6. Keep rollback proof or rollback instructions attached to the proposal evidence.

## Learning Route

If the user entered this flow with a phrase that the current classifier missed,
record it as host-local learning:

```bash
node atm.mjs guide learn --phrase "<missed phrase>" --intent legacy-atomization --reason "<why it means legacy atomization>" --status suggested --cwd . --json
```

Use `--status active-host` only after review. Do not promote host-specific
wording into framework defaults.

## Hard Stops

- Do not directly rewrite trunk or release-blocker functions.
- Do not manually choose `behavior.atomize`, `behavior.infect`, or
  `behavior.split`.
- Do not skip `LegacyRoutePlan`.
- Do not apply without a dry-run proposal and human review.
- Do not add adopter-specific project terms to framework fixtures, skill text,
  or default lexicons.
