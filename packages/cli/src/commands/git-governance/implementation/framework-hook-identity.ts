import { frameworkTempTaskId } from './task-scope-staging.ts';

/**
 * Adapts a lock-backed framework claim to the hook's task identity channel.
 * It never creates a ledger task: an explicit task keeps precedence and an
 * empty claim surface leaves the hook identity absent.
 */
export function resolveFrameworkHookTaskId(input: {
  readonly taskId: string | null;
  readonly actorId: string;
  readonly frameworkClaimCommitFiles: readonly string[];
}): string | null {
  if (input.taskId) return input.taskId;
  return input.frameworkClaimCommitFiles.length > 0
    ? frameworkTempTaskId(input.actorId)
    : null;
}
