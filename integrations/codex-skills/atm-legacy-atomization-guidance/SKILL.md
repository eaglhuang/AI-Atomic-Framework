---
name: atm-legacy-atomization-guidance
description: Use when a user asks to atomize, infect, transform, evolve, split, migrate, refactor, or safely extract legacy, old, inherited, monolithic, or hotspot code. Trigger examples include legacy atomization, old helper migration, existing atom infection, transform old flow, split hotspot, 原子化, 抽原子, 感染, 轉化, 分裂, 拆分, 舊系統, 舊流程, 遺留程式.
argument-hint: "<natural language goal>"
---

# ATM Legacy Atomization Guidance

This skill is the semantic front door for legacy atomization work in any host repository. It is intentionally adopter-neutral.

## Required First Step

Before reading host task docs to choose a behavior, run:

```bash
node atm.mjs guide --goal "<natural language goal>" --cwd . --json
```

If the host exposes an `atm` wrapper, the equivalent entrypoint is `atm guide --goal "<natural language goal>"`.

If the result reports `matchedIntent: "legacy-atomization"`, follow only the guided route below.

## Guided Route

1. Run `node atm.mjs orient --cwd . --json`.
2. Run the `nextCommand` returned by `guide`; it should be an `atm start --legacy-flow` command.
3. Run `node atm.mjs next --cwd . --json` (`atm next` when a host wrapper is available).
4. Execute exactly the single dry-run proposal command returned by `next`.
5. Stop for human review before any apply or host mutation.
6. Keep rollback proof or rollback instructions attached to the proposal evidence.

## Learning Route

If the user entered this flow with a phrase that the current classifier missed, record it as host-local learning:

```bash
node atm.mjs guide learn --phrase "<missed phrase>" --intent legacy-atomization --reason "<why it means legacy atomization>" --status suggested --cwd . --json
```

Use `--status active-host` only after review. Do not promote host-specific wording into framework defaults.

## Hard Stops

- Do not directly rewrite trunk or release-blocker functions.
- Do not manually choose `behavior.atomize`, `behavior.infect`, or `behavior.split`.
- Do not skip `LegacyRoutePlan`.
- Do not apply without a dry-run proposal and human review.
- Do not add adopter-specific project terms to framework fixtures, skill text, or default lexicons.
