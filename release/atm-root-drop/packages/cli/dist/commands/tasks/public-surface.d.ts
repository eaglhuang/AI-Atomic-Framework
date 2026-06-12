/**
 * Stable caller-facing contract for the tasks command surface.
 *
 * This file declares and re-exports symbols from packages/cli/src/commands/tasks.ts
 * that are consumed by other commands (such as next.ts, taskflow.ts, and taskflow/close-orchestration.ts).
 *
 * Direct dependencies on internal helpers of tasks.ts should be avoided, and
 * any evolution of this surface must be validated against the tasks-command-surface-invariant.
 */
import { runTasks, findTaskClaimDependencyBlockers, buildResidueDiagnosisEvidence, generateTaskCard, loadTaskDocumentOrThrow, runTasksRosterUpdate } from '../tasks.ts';
import type { TaskClaimDependencyBlocker, TaskResidueBucket, TaskResidueClassification } from '../tasks.ts';
export { runTasks, findTaskClaimDependencyBlockers, buildResidueDiagnosisEvidence, generateTaskCard, loadTaskDocumentOrThrow, runTasksRosterUpdate };
export type { TaskClaimDependencyBlocker, TaskResidueBucket, TaskResidueClassification };
