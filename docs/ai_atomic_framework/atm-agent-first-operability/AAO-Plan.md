# ATM Agent-First Operability Optimization Plan

## Summary

AAO is a separate follow-up track from `TASK-ASA-*`. It focuses on agent workflow ergonomics, CLI surface stability, validator readability, docs/schema drift, and onefile budget visibility.
ASA continues to own the framework self-atomization mainline. AAO only picks up the agent-operability gaps that ASA does not eliminate on its own.

## Bridge Principles

- Keep `TASK-ASA-0001` through `TASK-ASA-0016` on the ASA mainline.
- Route `any` debt work to `TASK-ATD-0023`; do not duplicate it here.
- Route root-drop / sandbox E2E work to `TASK-ATD-0032`; do not duplicate it here.
- AAO only addresses operability, drift guards, decision trail, validator envelopes, docs/schema alignment, and onefile budget reporting.

## Task Table

| task | title | milestone | status | dependencies | deliverables |
|---|---|---|---|---|---|
| TASK-AAO-0000 | AAO file mirror and ASA bridge index | M0 | done | none | mirror plan, README, tasks README |
| TASK-AAO-0001 | Report overlap matrix and route decisions | M1 | open | TASK-AAO-0000 | overlap matrix, routing table, bridge notes |
| TASK-AAO-0002 | CLI command spec / runner SSOT drift guard | M1 | open | TASK-AAO-0001, TASK-ASA-0009 | runner/spec/help drift guard, validate-cli assertions |
| TASK-AAO-0003 | next decisionTrail JSON contract | M1 | open | TASK-AAO-0001, TASK-ASA-0009 | stable decisionTrail shape, guidance assertions |
| TASK-AAO-0004 | validator failure envelope standardization | M2 | open | TASK-AAO-0001, TASK-ASA-0010 | stable failure envelope, validator harness updates |
| TASK-AAO-0005 | CLI context slimming wave 1 | M2 | open | TASK-AAO-0002, TASK-AAO-0003, TASK-ASA-0009 | split next/tasks helpers, keep behaviour stable |
| TASK-AAO-0006 | docs / schema / command drift guard | M3 | open | TASK-AAO-0002, TASK-AAO-0004, TASK-ASA-0010, TASK-ASA-0014 | docs drift validator, source-of-truth checks |
| TASK-AAO-0007 | onefile size / startup budget | M3 | open | TASK-AAO-0001, TASK-ASA-0014, TASK-ATD-0025, TASK-ATD-0032 | size/startup budget, release validation output |
| TASK-AAO-0008 | AAO roadmap backwrite and ASA bridge closure | M4 | open | TASK-AAO-0005, TASK-AAO-0006, TASK-AAO-0007 | bridge closure notes, roadmap backwrite |

## Overlap Matrix

| Problem | Route | Reason |
|---|---|---|
| 1. CLI giant files | TASK-ASA-0009 + TASK-AAO-0005 | ASA owns file ownership; AAO finishes the agent-facing context slimming |
| 2. any debt | TASK-ATD-0023 | already delegated to the debt-budget workstream |
| 3. CLI SSOT drift | TASK-AAO-0002 | fix runner/spec/help drift guard |
| 4. next decision trail | TASK-AAO-0003 | surface a stable decision summary, not chain-of-thought |
| 5. discoverability | TASK-AAO-0002 + TASK-AAO-0006 | spec/help/docs drift guard |
| 6. validator failure readability | TASK-AAO-0004 | normalize the failure envelope |
| 7. tests / E2E route | TASK-ATD-0032 | root-drop sandbox E2E stays delegated |
| 8. docs / schema drift | TASK-AAO-0006 | source-of-truth alignment |
| 9. validator / release budget | TASK-AAO-0007 + TASK-ASA-0014 | keep onefile budget visible without bundler churn |

## Validation Commands

- `node atm.mjs next --json`
- `npm run validate:cli`
- `npm run validate:standard`
- `npm run typecheck`
- `node atm.mjs doctor --json`

## Non-Goals

- Do not duplicate ASA coverage work.
- Do not reopen `TASK-ATD-0023` or `TASK-ATD-0032`.
- Do not introduce a new CLI framework.
- Do not treat this mirror as the authoritative AAO implementation source; it is a repo-local import bridge.

