# hook Command Atomic Map

## Scope

Read-only inventory for `packages/cli/src/commands/hook.ts` and the TASK-RFT-0002 phase modules extracted from the pre-split monolith. The sibling `hook/context-map-advisor.ts` is out of scope for this card.

## Atom List

| Atom | Pattern | Owner module | Focused spec |
|---|---|---|---|
| `hook.pre-commit` | Strategy Map (phase) | `packages/cli/src/commands/hook/pre-commit.ts` | `packages/cli/src/commands/hook/__tests__/pre-commit.spec.ts` |
| `hook.pre-push` | Strategy Map (phase) | `packages/cli/src/commands/hook/pre-push.ts` | `packages/cli/src/commands/hook/__tests__/pre-push.spec.ts` |
| `hook.commit-range-guard` | Strategy Map (phase) | `packages/cli/src/commands/hook/commit-range-guard.ts` | `packages/cli/src/commands/hook/__tests__/commit-range-guard.spec.ts` |
| `hook.git-hooks-installer` | Facade (install/verify) | `packages/cli/src/commands/hook/git-hooks-installer.ts` | `packages/cli/src/commands/hook/__tests__/git-hooks-installer.spec.ts` |
| `hook.git-index-diagnostics` | Policy Object | `packages/cli/src/commands/hook/git-index-diagnostics.ts` | `packages/cli/src/commands/hook/__tests__/git-index-diagnostics.spec.ts` |

## Line Count Summary

| Module | Before TASK-RFT-0002 | After TASK-RFT-0002 | Cap |
|---|---:|---:|---:|
| `packages/cli/src/commands/hook.ts` | 3429 | 87 | 600 (facade) |
| `packages/cli/src/commands/hook/pre-commit.ts` | — | 2561 | follow-up sub-split |
| `packages/cli/src/commands/hook/pre-push.ts` | — | 542 | follow-up if needed |
| `packages/cli/src/commands/hook/commit-range-guard.ts` | — | 662 | follow-up if needed |
| `packages/cli/src/commands/hook/git-hooks-installer.ts` | — | 192 | 600 |
| `packages/cli/src/commands/hook/git-index-diagnostics.ts` | — | 90 | 600 |

## Governance Invariants

- `hook pre-commit` / `hook pre-push` exit codes, blocking-finding shapes, and repair-hint text remain byte-stable versus the pre-split implementation.
- `runHook`, `runGitHooks`, `runCommitRangeGuard`, `inspectGitHooks`, and `installGitHooks` continue to export from `hook.ts`.
- Each hook phase owns its blocking-finding builder; pre-commit fixes must not weaken pre-push enforcement.
- `inspectProtectedAtmStateChanges` stays exported from `hook.ts` for task-id casing and batch validators.

## Duplicate Logic Hotspots

Follow-up extraction candidates (out of TASK-RFT-0002 scope):

- `pre-commit.ts` — attribution scanner, validator triage, protected-state inspection (~2,500 lines; needs dedicated RFT sub-card)
- `commit-range-guard.ts` — closure-packet inspection helpers (~660 lines)
- `pre-push.ts` — safe-mode reporting and ref-update parsing (~540 lines)

## Caller Surfaces

- `packages/cli/src/commands/hook.ts` — thin facade routing phase entrypoints
- `tests/cli/task-id-casing.test.ts` — imports `inspectProtectedAtmStateChanges`
- `scripts/validate-hook-batch-*.ts` — imports hook installer and protected-state helpers

## Extraction Targets

TASK-RFT-0002 delivers phase boundaries and a sub-600-line facade. Further cards should sub-split `pre-commit.ts` first because it blocks every governed commit.

## Validator Notes

`node --strip-types scripts/validate-hook-atomic-map.ts` asserts:

1. all five phase owner modules and focused specs exist;
2. `hook.ts` imports phase modules and no longer defines phase logic locally;
3. `hook.ts` exports `runHook`, `runGitHooks`, `runCommitRangeGuard`, `inspectGitHooks`, and `installGitHooks`;
4. `hook.ts` is below the 600-line facade cap and smaller than the pre-split baseline (3429 lines);
5. warns in this report (not the validator) when phase modules still exceed 600 lines pending follow-up splits.
