# Task Ledger Governance Atomic Map

## Scope

TASK-RFT-0004 splits `scripts/validate-task-ledger-governance.ts` into a registry-driven dispatcher plus 13 invariant owner modules.

## Atom List

| Atom | Owner module | Focused spec |
|---|---|---|
| residue-classification | `scripts/validators/task-ledger/residue-classification.ts` | `scripts/validators/task-ledger/__tests__/residue-classification.spec.ts` |
| taskflow-close-orchestration | `scripts/validators/task-ledger/taskflow-close-orchestration.ts` | `scripts/validators/task-ledger/__tests__/taskflow-close-orchestration.spec.ts` |
| planning-only-audit-boundary | `scripts/validators/task-ledger/planning-only-audit-boundary.ts` | inline self-test |
| closure-packet-dirty-tree-hygiene | `scripts/validators/task-ledger/closure-packet-dirty-tree-hygiene.ts` | inline self-test |
| task-import-dispatch-metadata | `scripts/validators/task-ledger/task-import-dispatch-metadata.ts` | inline self-test |
| task-import-refresh-claim-preservation | `scripts/validators/task-ledger/task-import-refresh-claim-preservation.ts` | inline self-test |
| tasks-roster-update-contract | `scripts/validators/task-ledger/tasks-roster-update-contract.ts` | inline self-test |
| tasks-new-rejects-root-output | `scripts/validators/task-ledger/tasks-new-rejects-root-output.ts` | inline self-test |
| taskflow-host-opener-fallback | `scripts/validators/task-ledger/taskflow-host-opener-fallback.ts` | inline self-test |
| sandbox-diagnostics-actionable | `scripts/validators/task-ledger/sandbox-diagnostics-actionable.ts` | inline self-test |
| last-transition-hash | `scripts/validators/task-ledger/last-transition-hash.ts` | inline self-test |
| emergency-use-pre-commit-audit | `scripts/validators/task-ledger/emergency-use-pre-commit-audit.ts` | inline self-test |
| ledger-readers-atomization | `scripts/validators/task-ledger/ledger-readers-atomization.ts` | inline self-test |

Shared helpers: `scripts/lib/task-ledger-invariant-registry.ts`, `scripts/lib/task-ledger-fixture-builder.ts`, `scripts/lib/task-ledger-assertions.ts`. Integration body retained in `scripts/validators/task-ledger/suite-impl.ts`.

## Line Count Summary

| Module | Before | After | Cap |
|---|---:|---:|---:|
| `scripts/validate-task-ledger-governance.ts` | 2749 | ~17 | 200 |
| `scripts/validators/task-ledger/suite-impl.ts` | — | ~2930 | follow-up |
| registry + 13 invariant modules | — | present | — |

## Validator Notes

`node --strip-types scripts/validate-task-ledger-atomic-map.ts` asserts 13 registry entries, owner modules, focused specs, and the facade line cap.
