# evidence Command Atomic Map

## Scope

Read-only inventory for `packages/cli/src/commands/evidence.ts` and the TASK-RFT-0007 verb/shared modules extracted from the pre-split monolith. Historical-batch helpers remain behind the facade via dedicated modules for line-budget reasons.

## Atom List

| Atom | Pattern | Owner module | Focused spec |
|---|---|---|---|
| `evidence.verb.add` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/add.ts` | `packages/cli/src/commands/evidence/__tests__/add.spec.ts` |
| `evidence.verb.run` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/run.ts` | `packages/cli/src/commands/evidence/__tests__/run.spec.ts` |
| `evidence.verb.verify` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/verify.ts` | `packages/cli/src/commands/evidence/__tests__/verify.spec.ts` |
| `evidence.verb.diff` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/diff.ts` | `packages/cli/src/commands/evidence/__tests__/diff.spec.ts` |
| `evidence.verb.validators` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/validators.ts` | `packages/cli/src/commands/evidence/__tests__/validators.spec.ts` |
| `evidence.verb.missing` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/missing.ts` | `packages/cli/src/commands/evidence/__tests__/missing.spec.ts` |
| `evidence.verb.git-head-backfill` | Strategy Map (verb) | `packages/cli/src/commands/evidence/verbs/git-head-backfill.ts` | `packages/cli/src/commands/evidence/__tests__/git-head-backfill.spec.ts` |
| `evidence.validator-classification` | Policy Object | `packages/cli/src/commands/evidence/validator-classification.ts` | `packages/cli/src/commands/evidence/__tests__/validator-classification.spec.ts` |
| `evidence.command-runs` | Result Contract Object | `packages/cli/src/commands/evidence/command-runs.ts` | `packages/cli/src/commands/evidence/__tests__/command-runs.spec.ts` |
| `evidence.missing-report` | Result Contract Object | `packages/cli/src/commands/evidence/missing-report.ts` | `packages/cli/src/commands/evidence/__tests__/missing.spec.ts` |

Supporting modules (scope-amended): `evidence/bundle-io.ts`, `evidence/evidence-store.ts`, `evidence/shared-utils.ts`, `evidence/historical-batch.ts`, `evidence/historical-batch-finalize.ts`.

## Line Count Summary

| Module | Before TASK-RFT-0007 | After TASK-RFT-0007 | Cap |
|---|---:|---:|---:|
| `packages/cli/src/commands/evidence.ts` | 2822+ | 53 | 250 (facade) |
| `packages/cli/src/commands/evidence/verbs/*.ts` | — | thin wrappers | 600 |
| `packages/cli/src/commands/evidence/validator-classification.ts` | — | ~140 | 600 |
| `packages/cli/src/commands/evidence/command-runs.ts` | — | ~210 | 600 |
| `packages/cli/src/commands/evidence/missing-report.ts` | — | ~270 | 600 |
| `packages/cli/src/commands/evidence/bundle-io.ts` | — | ~2800 | follow-up sub-split |

## Governance Invariants

- All seven verbs keep argv shape, exit codes, and JSON evidence shapes.
- `verifyTaskEvidence` and `computeMissingValidatorReport` remain exported from `evidence.ts`.
- Scope-path-aware `isClosureRequiredValidator` behavior (ATM-BUG-2026-07-09-065) is preserved in `validator-classification.ts`.

## Validator Notes

`node --strip-types scripts/validate-evidence-atomic-map.ts` asserts verb modules, shared modules, focused specs, facade exports, and the 250-line facade cap.
