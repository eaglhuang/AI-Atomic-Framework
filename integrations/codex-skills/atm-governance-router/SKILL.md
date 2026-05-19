---
name: atm-governance-router
description: Use when a user asks to inspect, rank, clean up, refactor, split, atomize, infect, migrate, modernize, prioritize existing source code, or open/import task cards from a plan before editing.
argument-hint: "<natural language goal>"
---

# ATM Governance Router

This skill is the semantic front door for natural-language governance routing in
any ATM adopter repository. It is intentionally adopter-neutral and English-only.

## Required First Step

Before reading host files to choose a behavior, run:

```bash
node atm.mjs guide --goal "<natural language goal>" --cwd . --json
```

If the host exposes an `atm` wrapper, the equivalent entrypoint is
`atm guide --goal "<natural language goal>"`.

## Candidate Ranking Route

If the result reports `matchedIntent: "legacy-candidate-ranking"`, follow the
returned `nextCommand`. It should create or cite:

- ATM guidance result
- candidate ranking artifact
- source inventory artifact
- police artifact
- recommended split, atomize, infect, or compose route

The canonical command shape is:

```bash
node atm.mjs candidates rank --include "pipelines/**/*.py" --goal "<natural language goal>" --json
```

With a host wrapper, use `atm candidates rank` with the same flags.

Do not rank the host source tree with ad-hoc shell-only heuristics when ATM can
produce evidence.

## Task Plan Import Route

If the result reports `matchedIntent: "task-plan-import"`, do not hand-write
`.atm/history/tasks/*.json` and do not use `atm create`. Task-plan import is a
work-item import flow; `atm create` is for atom birth.

Run the dry-run import first:

```bash
node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json
```

After the parsed manifest is reviewed, persist and verify it:

```bash
node atm.mjs tasks import --from <plan.md> --write --cwd . --json
node atm.mjs tasks verify --cwd . --json
node atm.mjs next --cwd . --json
```

Final reasoning should cite the guidance result, dry-run manifest, written task
paths, task-import evidence report, verify report, and the `next` result when it
surfaces imported open work items.

Do not acquire runtime locks for import-only task-plan operations. Keep
`.atm/history/tasks` as the canonical imported work-item store; host Markdown
views are optional secondary projections.

## Legacy Atomization Route

If the result reports `matchedIntent: "legacy-atomization"`, follow only the
guided route:

1. Run `node atm.mjs orient --cwd . --json`.
2. Run the `nextCommand` returned by `guide`.
3. Run `node atm.mjs next --cwd . --json`.
4. Execute exactly the single dry-run proposal command returned by `next`.
5. Stop for human review before any apply or host mutation.
6. Keep rollback proof or rollback instructions attached to the proposal evidence.

The canonical start command shape is `node atm.mjs start --legacy-flow` with the
goal and target details supplied by the guide output.

With a host wrapper, use `atm start --legacy-flow` with the same details.
Then use `atm next` as the wrapper form of `node atm.mjs next --cwd . --json`.

## Guided Fallback Contract

If ATM reports missing preferred documents, do not stop and do not silently
improvise. Preserve these fields in the evidence:

- `missingDocs[]`
- `fallbackSources[]`
- `continuedOriginalRequest: true`

Then continue the original user request with the fallback sources.

## Learning Route

If the user entered this flow with a phrase that the current classifier missed,
record it as host-local learning:

```bash
node atm.mjs guide learn --phrase "<missed phrase>" --intent legacy-candidate-ranking --reason "<why it means candidate ranking>" --status suggested --cwd . --json
```

Use `--status active-host` only after review. Do not promote host-specific
wording into framework defaults.

## Hard Stops

- Do not directly rewrite trunk or release-blocker functions.
- Do not manually choose `behavior.atomize`, `behavior.infect`, or
  `behavior.split`.
- Do not skip source inventory, police evidence, or a dry-run proposal when
  moving from ranking to mutation.
- Do not apply without human review.
- Do not add adopter-specific project terms to framework fixtures, skill text,
  or default lexicons.
