/**
 * Adapts a lock-backed framework claim to the hook's task identity channel.
 * It never reconstructs a ledger task from an actor: an explicit task keeps
 * precedence and a verified capability supplies the exact lock work-item id.
 */
export function resolveFrameworkHookTaskId(input: {
  readonly taskId: string | null;
  readonly frameworkClaimTaskId: string | null;
  readonly frameworkClaimCommitFiles: readonly string[];
}): string | null {
  if (input.taskId) return input.taskId;
  return input.frameworkClaimCommitFiles.length > 0
    ? input.frameworkClaimTaskId
    : null;
}
