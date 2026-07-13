# next Command Atomic Map

## Scope

Read-only inventory for `packages/cli/src/commands/next.ts` and the TASK-RFT-0001 governance atoms extracted from it. This report tracks the first-wave split; additional atoms remain inline in the facade until follow-up RFT cards land.

## Atom List

| Atom | Pattern | Owner module | Focused spec |
|---|---|---|---|
| `next.channel.strategy` | Strategy Map | `packages/cli/src/commands/next/channel-strategy.ts` | `packages/cli/src/commands/next/__tests__/channel-strategy.spec.ts` |
| `next.claim.admission` | Policy Object | `packages/cli/src/commands/next/claim-admission.ts` | `packages/cli/src/commands/next/__tests__/claim-admission.spec.ts` |
| `next.task-scoped-claim-command` | Result Contract Object | `packages/cli/src/commands/next/task-scoped-claim-command.ts` | `packages/cli/src/commands/next/__tests__/task-scoped-claim-command.spec.ts` |
| `next.runner-mode` | Facade | `packages/cli/src/commands/next/runner-mode.ts` | `packages/cli/src/commands/next/__tests__/runner-mode.spec.ts` |
| `next.next-action-assembly` | Result Contract Object | `packages/cli/src/commands/next/next-action-assembly.ts` | `packages/cli/src/commands/next/__tests__/next-action-assembly.spec.ts` |
| `next.prompt-scope-resolution` | Result Contract Object | `packages/cli/src/commands/next/prompt-scope-resolution.ts` | `packages/cli/src/commands/next/__tests__/next-action-assembly.spec.ts` |
| `next.worktree-hints` | Policy Object | `packages/cli/src/commands/next/worktree-hints.ts` | `packages/cli/src/commands/next/__tests__/next-action-assembly.spec.ts` |

Sibling modules already present before TASK-RFT-0001 (`next/intent-normalizers.ts`, `next/match-and-sort.ts`, `next/route-predicates.ts`, `next/view-projections.ts`, `next/planning-root-preference.ts`) are out of scope for this card.

## Line Count Summary

| Module | Before TASK-RFT-0001 | After TASK-RFT-0001 | Cap |
|---|---:|---:|---:|
| `packages/cli/src/commands/next.ts` | 5156 | 4974 | 1200 (long-term facade target) |
| `packages/cli/src/commands/next/channel-strategy.ts` | — | 198 | 600 |
| `packages/cli/src/commands/next/claim-admission.ts` | 139 | 139 | 600 |
| `packages/cli/src/commands/next/task-scoped-claim-command.ts` | — | 42 | 600 |
| `packages/cli/src/commands/next/runner-mode.ts` | — | 101 | 600 |
| `packages/cli/src/commands/next/next-action-assembly.ts` | new | 243 | parameterized `--max-lines 600` |
| `packages/cli/src/commands/next/prompt-scope-resolution.ts` | new | 20 | parameterized `--max-lines 600` |
| `packages/cli/src/commands/next/worktree-hints.ts` | new | 21 | parameterized `--max-lines 600` |
| `packages/cli/src/commands/next/__tests__/next-action-assembly.spec.ts` | new | 84 | parameterized `--max-lines 600` |

## Governance Invariants

- `next --json` and `next --claim` evidence shapes remain byte-stable for TASK-CID-0073 fields (`taskScopedClaimCommand`, `claimCommandShape`).
- Broker/CID claim admission stays broker-verdict-first via `evaluateClaimAdmission`.
- Runner-mode wrapping remains additive (`ATM_RUNNER_MODE` message, `evidence.runnerMode`).
- Each extracted atom stays below 600 lines; further splits must add new owner modules rather than growing a single atom past the cap.

## Duplicate Logic Hotspots

Residual inline owners still in `next.ts` (follow-up extraction candidates):

- `inspectImportedTaskQueue` and markdown/json task discovery
- `buildPromptScopedNextResult` channel orchestration
- `claimNextImportedTask` claim orchestration
- `buildChannelPlaybook` / `buildNextMessages`

## TASK-RFT-0022 Second-Wave Extraction

`TASK-RFT-0022` extracted the nextAction assembly contract without changing route selection:

- `next-action-assembly.ts` now owns `NextActionLike`, decision trail construction, selected task id extraction, and queue-head id extraction.
- `prompt-scope-resolution.ts` owns prompt-scoped queue claim command construction, including the planning-card import override and JSON-safe prompt quoting.
- `worktree-hints.ts` owns the predicate for emitting dirty-worktree scope hints from `buildNextMessages`.

The 600-line atom limit is intentionally enforced through the parameterized validator:

```powershell
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files packages/cli/src/commands/next/next-action-assembly.ts,packages/cli/src/commands/next/prompt-scope-resolution.ts,packages/cli/src/commands/next/worktree-hints.ts,packages/cli/src/commands/next/__tests__/next-action-assembly.spec.ts,docs/reports/next-command-atomic-map.md
```

## Caller Surfaces

- `packages/cli/src/commands/next.ts` — thin facade importing the four atoms
- `packages/cli/src/commands/next/__tests__/claim-admission-broker-parity.spec.ts` — RFT-0011 broker parity regression (kept alongside TASK-RFT-0001 spec)

## Extraction Targets

Follow-up cards should continue shrinking `next.ts` toward the 1,200-line facade target without widening TASK-RFT-0001 scope.

## Validator Notes

`node --strip-types scripts/validate-next-atomic-map.ts` asserts:

1. all four atom owner modules and focused specs exist;
2. each atom owner module is below 600 lines;
3. `next.ts` imports the atoms and no longer defines the extracted helpers locally;
4. `next.ts` is smaller than the pre-split baseline (5156 lines);
5. warns when `next.ts` is still above the 1,200-line long-term target.
