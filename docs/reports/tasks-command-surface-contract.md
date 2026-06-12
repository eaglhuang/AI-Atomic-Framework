# Tasks Command Surface Contract

This document defines the stable, caller-facing surface contract for the `tasks` command in the AI-Atomic-Framework (AAF).

## Design Invariants

1. **Explicit API Boundaries**: Caller-facing interfaces (commands, helpers, types) must be defined and re-exported through the `packages/cli/src/commands/tasks/public-surface.ts` entry point.
2. **Backward Compatibility**: Any consumer of `tasks` (e.g., `next.ts`, `taskflow.ts`, `close-orchestration.ts`, or outer CLI entry points) must depend only on the symbols exposed by the public surface.
3. **No Drift Verification**: The contract enforces validation checks to ensure that the source-side declaration in `public-surface.ts` is fully synchronized with the built release-side artifacts.

## Stable Export Catalog

The following symbols are frozen as part of the public contract:

### Stable Helpers
- `runTasks(argv: string[])`: The primary CLI execution runner for tasks commands.
- `findTaskClaimDependencyBlockers(cwd: string, taskId: string, taskDocument: Record<string, unknown>)`: Retrieves any active blocker reasons for task claims.
- `buildResidueDiagnosisEvidence(cwd: string, taskId: string, taskDocument: Record<string, unknown>)`: Generates structured troubleshooting details for incomplete closeouts.
- `generateTaskCard(input: GenerateTaskCardInput)`: Generates Markdown task card template contents.
- `loadTaskDocumentOrThrow(cwd: string, taskId: string)`: Loads and parses a task document JSON structure.
- `runTasksRosterUpdate(argv: string[])`: Dedicated task runner specifically targeting roster updates.

### Stable Types
- `TaskClaimDependencyBlocker`: Type representing task claim blockers.
- `TaskResidueBucket`: Enumerated categories representing governance residues.
- `TaskResidueClassification`: Structured diagnosis container for ambiguous/manual review tasks.

## Evolution Guidelines

If the public contract must evolve (e.g., exposing a new helper or changing a type shape):
1. **Never delete or rename** an existing exported symbol without a formal upgrade proposal and waiver flow.
2. Update `packages/cli/src/commands/tasks/public-surface.ts` with the new exports.
3. Update the symbol whitelist in the validator script `scripts/validate-tasks-command-surface.ts`.
4. Run `npm run build` to compile the release-side drop and ensure the validator passes without reporting drift.
