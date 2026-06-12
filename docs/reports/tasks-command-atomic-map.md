# TASK-CID-0050 Tasks Command Atomic Map

## Scope

Read-only inventory for `packages/cli/src/commands/tasks.ts` and the caller surfaces used by `next.ts` and `next/route-predicates.ts`.

This report does not change production command behavior. It exists to define the shared atom map before any extraction work in the `TASK-CID-0050` to `TASK-CID-0059` family.

## Atom List

| Atom | Responsibility | Primary File(s) | Notes |
| --- | --- | --- | --- |
| `tasks.command.dispatch` | Top-level `tasks` action router | `packages/cli/src/commands/tasks.ts` | Fan-out over `close`, `reset`, `claim`, `reconcile`, `repair-closure`, `status`, `finalize`, etc. |
| `tasks.close.governance` | Close path governance and closure packet enforcement | `packages/cli/src/commands/tasks.ts` | Owns close command admission, closure authority, historical delivery, and commit-window registration. |
| `tasks.claim.lifecycle` | Claim / renew / release / handoff / takeover lifecycle | `packages/cli/src/commands/tasks.ts`, `packages/core/src/broker/lifecycle.ts` | Shared claim-state logic with broker claim intent recording. |
| `tasks.reconcile.delivery` | Historical delivery reconciliation and provenance | `packages/cli/src/commands/tasks.ts` | Handles delivery commit refs, provenance checks, and close/truth repair. |
| `tasks.repair.closure` | Closure packet repair / normalization | `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/framework-development.ts` | Repairs closure packet before closeout. |
| `tasks.status.triangulation` | Status / claim / planning mirror truth triangulation | `packages/cli/src/commands/tasks.ts` | Compares live ledger, planning frontmatter, and last transition event. |
| `tasks.residue.diagnostics` | Residue bucket classification and next-command recommendation | `packages/cli/src/commands/tasks.ts` | Produces `complete-but-unfinalized`, `interrupted-close`, `planning-mirror-only`, etc. |
| `tasks.scope.locking` | Scope-lock and path gating for tasks | `packages/cli/src/commands/tasks.ts` | Governs current task lock state and write surface restriction. |
| `tasks.ledger.import.verify` | Import / verify / legacy-ledger migration surfaces | `packages/cli/src/commands/tasks.ts` | Maintains task-store and task-event synchronization. |
| `next.imported-task.routing` | Imported-task queue selection and claim routing | `packages/cli/src/commands/next.ts` | Finds the queue head and prepares claimable tasks. |
| `next.route.predicates` | Predicate library for routing decisions | `packages/cli/src/commands/next/route-predicates.ts` | Shared logic for dependency gating, claim state, explicit route matching, and closed-task checks. |

## Governance Invariants

- Closeout provenance must be command-backed, not just frontmatter-backed.
- A task is only claimable when dependency satisfaction and lifecycle state both permit it.
- Historical delivery is part of close validation when the card declares it.
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
5. Scope-lock and residue diagnostics share task-truth context but should remain separate atoms.

## Caller Surfaces

- `packages/cli/src/commands/tasks.ts`
- `packages/cli/src/commands/next.ts`
- `packages/cli/src/commands/next/route-predicates.ts`

## Extraction Targets

- Keep `tasks.command.dispatch` as the entrypoint atom.
- Split governance into separate atoms for closeout, claim lifecycle, reconcile, status triangulation, and residue diagnostics.
- Keep route predicates as a reusable routing library rather than duplicating state checks inside `next.ts`.

## Validator Notes

- Required sections: `Scope`, `Atom List`, `Governance Invariants`, `Duplicate Logic Hotspots`, `Caller Surfaces`, `Extraction Targets`, `Validator Notes`.
- The validator should fail closed if any required section is missing or if the atom list does not mention the three caller surfaces.

## Report Summary

- This map is intentionally read-only.
- It identifies where downstream extraction should slice the `tasks` command without changing runtime behavior in this task.
