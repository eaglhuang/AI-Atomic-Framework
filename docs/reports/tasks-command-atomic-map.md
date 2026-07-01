# TASK-CID-0050 Tasks Command Atomic Map

## Scope

Read-only inventory for `packages/cli/src/commands/tasks.ts` and the caller surfaces used by `next.ts` and `next/route-predicates.ts`.

This report does not change production command behavior. It exists to define the shared atom map before any extraction work in the `TASK-CID-0050` to `TASK-CID-0059` family.

## Atom List

| Atom | Responsibility | Primary File(s) | Notes |
| --- | --- | --- | --- |
| `tasks.command.dispatch` | Top-level `tasks` action router | `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/tasks/command-dispatch.ts` | `tasks.ts` now supplies the handler table; `command-dispatch.ts` owns argv normalization, action aliases, usage errors, and fan-out over `close`, `reset`, `claim`, `reconcile`, `repair-closure`, `status`, `finalize`, etc. |
| `tasks.close.governance` | Close path governance and closure packet enforcement | `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/tasks/close-orchestrator.ts` | Owns close command admission, closure authority, historical delivery, and commit-window registration. Under TASK-RFT-0012 the `runTasksClose` orchestrator body lives in `tasks/close-orchestrator.ts`; `tasks.ts` re-exports it and keeps only the router surface. |
| `tasks.claim.lifecycle` | Claim / renew / release / handoff / takeover lifecycle | `packages/cli/src/commands/tasks.ts`, `packages/core/src/broker/lifecycle.ts` | Shared claim-state logic with broker claim intent recording. |
| `tasks.reconcile.delivery` | Historical delivery reconciliation and provenance | `packages/cli/src/commands/tasks.ts` | Handles delivery commit refs, provenance checks, and close/truth repair. |
| `tasks.repair.closure` | Closure packet repair / normalization | `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/framework-development.ts` | Repairs closure packet before closeout. |
| `tasks.status.triangulation` | Status / claim / planning mirror truth triangulation | `packages/cli/src/commands/tasks.ts` | Compares live ledger, planning frontmatter, and last transition event. |
| `tasks.residue.diagnostics` | Residue bucket classification and next-command recommendation | `packages/cli/src/commands/tasks.ts` | Produces `complete-but-unfinalized`, `interrupted-close`, `planning-mirror-only`, etc. |
| `tasks.scope.locking` | Scope-lock and path gating for tasks | `packages/cli/src/commands/tasks.ts` | Governs current task lock state and write surface restriction. |
| `tasks.surface.invariants` | Shared closeout routing, backend selection, and validator strategy | `packages/cli/src/commands/tasks/surface-invariants.ts`, `packages/cli/src/commands/taskflow/close-orchestration.ts` | `surface-invariants.ts` owns close mode / backend policy and close evidence validator constants; `close-orchestration.ts` consumes the strategy without owning the table. |
| `tasks.ledger.import.verify` | Import / verify / legacy-ledger migration surfaces | `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/tasks/import-orchestrator.ts`, `packages/cli/src/commands/tasks/verify-orchestrator.ts` | Maintains task-store and task-event synchronization. Under TASK-RFT-0012 the `runTasksImport` and `runTasksVerify` orchestrator bodies live in `tasks/import-orchestrator.ts` and `tasks/verify-orchestrator.ts`; `tasks.ts` re-exports them. |
| `next.imported-task.routing` | Imported-task queue selection and claim routing | `packages/cli/src/commands/next.ts` | Finds the queue head and prepares claimable tasks. |
| `next.route.predicates` | Predicate library for routing decisions | `packages/cli/src/commands/next/route-predicates.ts` | Shared logic for dependency gating, claim state, explicit route matching, and closed-task checks. |

## Governance Invariants

- Closeout provenance must be command-backed, not just frontmatter-backed.
- A task is only claimable when dependency satisfaction and lifecycle state both permit it.
- Historical delivery is part of close validation when the card declares it.
- Taskflow close mode, backend selection, and close evidence validator policy must be owned by `tasks.surface.invariants`, not duplicated inside orchestration code.
- Scope locks and residue diagnostics are separate concerns and must not be conflated with delivery success.
- Closed task truth must stay consistent across live ledger, planning mirror, and last transition evidence.

## Duplicate Logic Hotspots

1. Closeout provenance appears in multiple forms:
   - live ledger status
   - planning frontmatter status
   - last transition event status
   - closure packet / historical delivery evidence
2. Dependency gating is split between `tasks.ts` close / claim flows and `next/route-predicates.ts`.
3. Lifecycle state checks appear in both queue selection and claim admission.
4. Historical delivery appears in close, reconcile, and residue diagnostics.
5. Taskflow close strategy previously lived directly inside `taskflow/close-orchestration.ts`; `tasks.surface.invariants` now owns the strategy table.
6. Scope-lock and residue diagnostics share task-truth context but should remain separate atoms.

## Caller Surfaces

- `packages/cli/src/commands/tasks.ts`
- `packages/cli/src/commands/next.ts`
- `packages/cli/src/commands/next/route-predicates.ts`

## Extraction Targets

- Keep `tasks.command.dispatch` as the entrypoint atom.
- Split governance into separate atoms for closeout, claim lifecycle, reconcile, status triangulation, and residue diagnostics.
- Keep route predicates as a reusable routing library rather than duplicating state checks inside `next.ts`.
- Keep closeout strategy as `tasks.surface.invariants`, with taskflow orchestration consuming the strategy rather than owning it.

## TASK-CID-0062 Update

- `packages/cli/src/commands/tasks/dependency-gates.ts` is the plural dependency admission facade. It preserves `dependency-gate.ts` as the implementation owner while giving `tasks.ts` a stable Strategy Map entry point.
- `packages/cli/src/commands/tasks/surface-invariants.ts` owns taskflow close mode selection, close backend selection, and close evidence validator policy.
- `packages/cli/src/commands/taskflow/close-orchestration.ts` now consumes `resolveTaskflowCloseMode`, `resolveTaskflowCloseBackend`, and close evidence validator constants from `tasks.surface.invariants`.
- `scripts/validate-cli.ts` now verifies the dependency admission facade and the invariant surface exports required by `TASK-CID-0062`.

## TASK-CID-0058 Update

- Before this task, `packages/cli/src/commands/tasks.ts` was 5890 lines and contained the top-level action fan-out directly inside `runTasks`.
- `tasks.command.dispatch` moved into `packages/cli/src/commands/tasks/command-dispatch.ts`, with focused coverage in `packages/cli/src/commands/tasks/__tests__/command-dispatch.test.ts`.
- After the extraction, `packages/cli/src/commands/tasks.ts` is 5829 lines. It keeps the public `runTasks` facade and a handler table, while the new 102-line `command-dispatch.ts` owns `--output-json` cleanup, action aliasing for `block` / `abandon`, lifecycle action grouping, and CLI usage errors.
- The new focused dispatch test is 65 lines and covers argv normalization, alias routing, lifecycle action identity, missing action errors, and unknown action errors.
- Closeout, dependency, lifecycle, historical-delivery, scope-lock, and residue trust decisions remain in their existing owner atoms; this task only moved dispatch responsibility.

## Validator Notes

- Required sections: `Scope`, `Atom List`, `Governance Invariants`, `Duplicate Logic Hotspots`, `Caller Surfaces`, `Extraction Targets`, `Validator Notes`.
- The validator should fail closed if any required section is missing or if the atom list does not mention the three caller surfaces.
- TASK-CID-0058 requires the report to mention `packages/cli/src/commands/tasks/command-dispatch.ts` so future map checks keep the dispatch atom visible.
- TASK-CID-0062 requires the report to mention `packages/cli/src/commands/tasks/dependency-gates.ts` and `packages/cli/src/commands/tasks/surface-invariants.ts` so future map checks keep the governance invariant owner modules visible.

## TASK-RFT-0010 Update

TASK-RFT-0010 split the residual mass inside `packages/cli/src/commands/tasks.ts`
into four owner modules using the four-layer pattern (Facade / Policy Objects /
Strategy Maps / Result Contract Objects). Logic is moved verbatim; the public
JSON contracts (`atm.taskImportManifest`, `atm.taskVerifyReport`,
`atm.taskLegacyLedgerMigrationReport`, `atm.taskDeliverableGate.v1`) are
unchanged.

### Four-Layer Map (post TASK-RFT-0010)

| Layer | Module | Atom | Responsibility |
| --- | --- | --- | --- |
| Facade | `packages/cli/src/commands/tasks.ts` | `tasks.command.dispatch` | argv parse, action fan-out, re-export of public types and command runners |
| Policy Object | `packages/cli/src/commands/tasks/close-governance.ts` | `tasks.close.governance` | close authority, closure-packet trust, blocker-code classification, stale-runner override audit, failed-emergency-use audit |
| Strategy Map | `packages/cli/src/commands/tasks/status-triangulation.ts` | `tasks.status.triangulation` | live-ledger vs planning-truth comparison, parity-override strategy, residue/recovery route selection |
| Result Contract Object | `packages/cli/src/commands/tasks/import-verify.ts` | `tasks.ledger.import.verify` | import / verify / migration envelope builders, diagnostic normalization, finding sort |
| Result Contract Object (shared) | `packages/cli/src/commands/tasks/result-contracts.ts` | `tasks.command.result-contracts` | typed contracts for import / verify / migration / deliverable-gate; pinned schemaIds; additive-tolerance helper |

### Specs

| Owner module | Spec |
| --- | --- |
| `packages/cli/src/commands/tasks/close-governance.ts` | `packages/cli/src/commands/tasks/__tests__/close-governance.spec.ts` |
| `packages/cli/src/commands/tasks/status-triangulation.ts` | `packages/cli/src/commands/tasks/__tests__/status-triangulation.spec.ts` |
| `packages/cli/src/commands/tasks/import-verify.ts` | `packages/cli/src/commands/tasks/__tests__/import-verify.spec.ts` |
| `packages/cli/src/commands/tasks/result-contracts.ts` | `packages/cli/src/commands/tasks/__tests__/result-contracts.spec.ts` |

### Before/After Line Counts (TASK-RFT-0010)

- `packages/cli/src/commands/tasks.ts`: **7896 → 7484** (-412 lines)
- New `packages/cli/src/commands/tasks/result-contracts.ts`: **229 lines**
- New `packages/cli/src/commands/tasks/status-triangulation.ts`: **270 lines**
- New `packages/cli/src/commands/tasks/close-governance.ts`: **278 lines**
- New `packages/cli/src/commands/tasks/import-verify.ts`: **220 lines**

`tasks.ts` continues to host the `runTasksClose`, `runTasksStatus`,
`runTasksReconcile`, `runTasksImport`, `runTasksVerify`, and
`runTasksMigrateLegacyLedger` orchestrators. The new owner modules supply the
policy/strategy/contract decisions those orchestrators previously made inline,
and `tasks.ts` thin-aliases the in-file call sites (`buildTaskStatusTriangulation`,
`recordStaleRunnerOverride`, `recordFailedEmergencyUseAttempt`,
`isCliErrorWithCode`) plus re-exports the public types (`TaskImport*`,
`TaskVerify*`, `TaskLegacyLedger*`, `TaskDeliverableGateReport`) so callers
see no surface change.

## Report Summary

- This map is intentionally read-only.
- It identifies where downstream extraction should slice the `tasks` command without changing runtime behavior in this task.
