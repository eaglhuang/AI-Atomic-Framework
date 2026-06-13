# TASK-CID-0059 Tasks Atomic Map Dogfood Report

## Scope

This report is the final read-only dogfood check for the `TASK-CID-0054` to `TASK-CID-0058` extraction wave. It validates the tasks command atom map as data: atom id, owner module, callers, focused test, CLI regression coverage, delivery commit, runner-sync evidence, accepted atom pattern vocabulary, and residual duplication.

No production refactor is performed by `TASK-CID-0059`.

## Line Count Summary

| Surface | Before Extraction | Current | Notes |
| --- | ---: | ---: | --- |
| `packages/cli/src/commands/tasks.ts` | 5890 lines before `TASK-CID-0058` | 5829 lines | The public facade remains here; command dispatch moved out. |
| `packages/cli/src/commands/tasks/lifecycle-state.ts` | 0 lines | 147 lines | Owner for claim lifecycle state contract. |
| `packages/cli/src/commands/tasks/historical-delivery.ts` | 0 lines | 221 lines | Owner for historical delivery reconciliation and provenance. |
| `packages/cli/src/commands/tasks/scope-lock-diagnostics.ts` | 0 lines | 206 lines | Owner for scope-lock diagnostics and path-gate reporting. |
| `packages/cli/src/commands/tasks/residue-diagnostics.ts` | 0 lines | 228 lines | Owner for residue bucket classification and recovery command hints. |
| `packages/cli/src/commands/tasks/command-dispatch.ts` | 0 lines | 102 lines | Owner for top-level task action dispatch and aliases. |

## Atom Map As Data

| Task | Atom Id | Pattern | Owner Module | Callers | Focused Test | CLI Regression | Source/Test Delivery Commit | Runner-Sync Evidence | Residual Duplication |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TASK-CID-0054` | `tasks.claim.lifecycle` | Policy Object / Result Contract Object | `packages/cli/src/commands/tasks/lifecycle-state.ts` | `packages/cli/src/commands/tasks.ts`, `packages/core/src/broker/lifecycle.ts` | `packages/cli/src/commands/tasks/__tests__/lifecycle-state.test.ts` | `npm run validate:cli` | `ec9d8be8` | No separate runner-sync commit recorded for this atom; sync artifacts were bundled in `ec9d8be8`. | Claim admission still has caller-specific plumbing in `tasks.ts`, but lifecycle state interpretation has one owner. |
| `TASK-CID-0055` | `tasks.reconcile.delivery` | Result Contract Object | `packages/cli/src/commands/tasks/historical-delivery.ts` | `packages/cli/src/commands/tasks.ts` | `packages/cli/src/commands/tasks/__tests__/historical-delivery.test.ts` | `npm run validate:cli` | `01d52402` | No separate runner-sync commit recorded for this atom; sync artifacts were bundled in `01d52402`. | Close and reconcile still pass task context separately, but historical delivery truth has one owner. |
| `TASK-CID-0056` | `tasks.scope.locking` | Policy Object / Result Contract Object | `packages/cli/src/commands/tasks/scope-lock-diagnostics.ts` | `packages/cli/src/commands/tasks.ts` | `packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts` | `npm run validate:cli` | `e66a0335` | No separate runner-sync commit recorded for this atom; sync artifacts were bundled in `e66a0335`. | Scope diagnostics still depend on task truth supplied by callers; lock-state classification has one owner. |
| `TASK-CID-0057` | `tasks.residue.diagnostics` | Strategy Map / Result Contract Object | `packages/cli/src/commands/tasks/residue-diagnostics.ts` | `packages/cli/src/commands/tasks.ts` | `packages/cli/src/commands/tasks/__tests__/residue-diagnostics.test.ts` | `npm run validate:cli` | `a699c87e` | No separate runner-sync commit recorded for this atom; sync artifacts were bundled in `a699c87e`. | Residue reporting still consumes closeout state from `tasks.ts`; residue bucket policy has one owner. |
| `TASK-CID-0058` | `tasks.command.dispatch` | Facade | `packages/cli/src/commands/tasks/command-dispatch.ts` | `packages/cli/src/commands/tasks.ts` | `packages/cli/src/commands/tasks/__tests__/command-dispatch.test.ts` | `npm run validate:cli` | `d9b5d46b` | No separate runner-sync commit recorded for this atom; sync artifacts were bundled in `d9b5d46b`. | `tasks.ts` still owns handler construction; action normalization and fan-out have one owner. |

This split is explicit because `TASK-CID-0059` needs source/test delivery and runner-sync evidence reported separately. The earlier wave did not create standalone runner-sync commits, so the report records that fact instead of inventing a second SHA.

Accepted atom pattern vocabulary for this map is `Policy Object`, `Strategy Map`, `Result Contract Object`, `Facade`, and `Adapter/Port`. This wave did not need a new Adapter/Port atom; the vocabulary is retained so future map validators do not silently narrow the accepted ATM pattern model.

## Single Owner Check

| Concern | Single Owner Module | Status |
| --- | --- | --- |
| Dependency checks | `packages/cli/src/commands/tasks/dependency-gate.ts` | Pass. `packages/cli/src/commands/next/route-predicates.ts` imports this owner as a caller surface. |
| Closeout governance | `packages/cli/src/commands/tasks.ts`, with provenance checks in `packages/cli/src/commands/tasks/closeout-provenance.ts` | Pass for this wave. Full governance extraction remains a follow-up, but provenance has a named helper owner instead of an anonymous inline check. |
| Historical delivery | `packages/cli/src/commands/tasks/historical-delivery.ts` | Pass. |
| Lifecycle | `packages/cli/src/commands/tasks/lifecycle-state.ts` | Pass. |
| Scope lock | `packages/cli/src/commands/tasks/scope-lock-diagnostics.ts` | Pass. |
| Residue checks | `packages/cli/src/commands/tasks/residue-diagnostics.ts` | Pass. |
| Command dispatch | `packages/cli/src/commands/tasks/command-dispatch.ts` | Pass. |

## Abnormal Release Regression Check

`TASK-CID-0047` documented an abnormal-release path around closeout and release evidence. This wave did not reopen that path:

- Source/test delivery commits were made before close ledger commits for each extracted atom.
- Close commits were produced through ATM taskflow/task close lanes rather than a raw status edit.
- `validate:git-head-evidence` was used during prior closeouts where the close flow required head evidence.
- `TASK-CID-0057` and `TASK-CID-0058` both ended with `tasks status --residue` reporting `no-residue`.

The remaining risk is procedural, not a reopened source path: if a future closeout accepts stale or directory-shaped deliverables without a recovery command, the operator can still spend time on metadata repair before the normal lane succeeds.

## Validator Results

The required `TASK-CID-0059` commands are:

| Validator | Expected Evidence |
| --- | --- |
| `npm run typecheck` | TypeScript source tree compiles. |
| `node --strip-types scripts/validate-tasks-atomic-map.ts` | This report and the base atom map are structurally checked. |
| `npm run validate:cli` | CLI protected-surface and command regression checks pass. |
| `git diff --check` | No whitespace errors in the touched diff. |

## Residual Risk

- `packages/cli/src/commands/tasks.ts` is still large at 5829 lines; this report only validates the completed extraction wave.
- `tasks.close.governance`, `tasks.status.triangulation`, and `tasks.ledger.import.verify` remain inventory entries in `docs/reports/tasks-command-atomic-map.md` rather than completed peer extractions.
- `next.route.predicates` remains a caller surface and future extraction candidate, not a finished atom in this wave; dependency truth itself is owned by `packages/cli/src/commands/tasks/dependency-gate.ts`.
- No anonymous inline pipeline was added by this task. Existing closeout and dependency plumbing can still contain duplicated trust checks until the later governance-invariant tasks extract them.

## Conclusion

The wave improved maintainability by giving lifecycle, historical-delivery, scope-lock, residue, and command-dispatch decisions explicit owner modules with focused tests. The atom map is now represented in a table that can be mechanically validated, while the remaining shared governance surfaces are named as residual risk for the next CID tasks.
