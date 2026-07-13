# RFT Second-Wave Closeout Report

Date: 2026-07-14
Actor: Codex-GPT 5.5
Repository: AI-Atomic-Framework

## Scope

This report summarizes the second RFT atomization wave for ATM framework source files:

- TASK-RFT-0020: git governance command surface
- TASK-RFT-0021: team command surface
- TASK-RFT-0022: next command surface
- TASK-RFT-0023: team agents runtime and bridge files
- TASK-RFT-0024: tasks command surface
- TASK-RFT-0025: framework root and integration surfaces

All six task cards are closed with closure packets. Delivery commits are:

- `c47c771fe` / `3cd236598` for TASK-RFT-0020 source and runner sync
- `0c38236d827cb7049de20aa91d0097921b60b5f4` for TASK-RFT-0021
- `3c17dd452f5f17a80cc9aa38c8255ec726c6c300` for TASK-RFT-0022
- `648ea16c0773daf995cafd9e28f66ed1d369dc13` for TASK-RFT-0023
- `ee65c657cb1bc2bff3244e765693c45cdb26d608` for TASK-RFT-0024
- `7c9e7b5343a8bd5dffe71f43a50ccacea7baf685` for TASK-RFT-0025
- `8ff7d53db3efe5f14e7e59c949fb281a77ba8f31` for the final runner artifact sync

## Line Budget

The target line budget is intentionally parameterized, not hard-coded:

```bash
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files <comma-separated-files>
```

For this wave, newly extracted atom map, helper, and command modules were kept below `--max-lines 600`. Future RFT waves can tighten the same budget, for example to `--max-lines 500`, without changing the validator source.

## Validation Pattern

The reliable closeout pattern was:

- Run the focused task validator first.
- Run `npm run typecheck`.
- Run `npm run validate:cli`.
- Run `npm run validate:git-head-evidence`.
- Sync frozen runner artifacts only after source validation passes.
- Keep release mirror changes in a dedicated runner-sync commit.

Focused validators and closure packets were more useful than broad visual inspection for this wave because the affected files are governance and CLI surfaces.

## Team Agents Observations

ATM Team-level guidance was useful as a risk indicator, but most RFT work was faster with local captain execution and internal sidecar-style inspection than with external write delegation.

Recommended future routing:

- Use internal sidecars for inventory, line-count audits, map consistency checks, and post-report verification.
- Use external Team Agents only when the task has separable file ownership and a clean broker state.
- Avoid concurrent runner-sync work unless the active captains agree on release artifact ownership first.
- Release stale broker intents before planning or claiming another RFT card.

## Workflow Friction Found

The wave produced several useful ATM dogfood findings:

- Batch checkpoint can close the current queue head, then validate the staged close artifacts against the next queue head's scope.
- Stale broker shared-surface state can make a finished or unrelated task look like an active conflict.
- Post-close claim release metadata can leave `.atm/history/tasks/<task>.json` dirty without a matching transition event.
- Release mirror artifacts should remain isolated in explicit runner-sync commits.
- Evidence validator names should be exact, not informal aliases, because closure packets depend on stable validator identifiers.

The post-close claim release residue is recorded as `ATM-BUG-2026-07-14-185`.

## Follow-Up Candidates

Next atomization candidates should be ranked with the same configurable line budget:

```bash
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files <comma-separated-files>
```

Prioritize files that combine command routing, state mutation, and user-facing diagnostics. Those files benefit most from atom-map separation because small focused scripts reduce accidental edits, technical debt, and regression risk.
