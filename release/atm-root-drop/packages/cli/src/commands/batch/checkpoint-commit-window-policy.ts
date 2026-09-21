export interface CheckpointContinuationDecision {
  readonly state: 'complete' | 'pending-commit' | 'ready-to-resume';
  readonly mayClaimNext: boolean;
  readonly pendingCommitTaskId: string | null;
  readonly reason: string;
}

export function decideCheckpointContinuation(input: {
  readonly closedTaskId: string | null;
  readonly nextTaskId: string | null;
  readonly pendingWindowTaskId?: string | null;
}): CheckpointContinuationDecision {
  if (!input.nextTaskId) {
    return { state: 'complete', mayClaimNext: false, pendingCommitTaskId: input.closedTaskId, reason: 'No next queue head exists.' };
  }
  if (input.closedTaskId) {
    return {
      state: 'pending-commit',
      mayClaimNext: false,
      pendingCommitTaskId: input.closedTaskId,
      reason: 'The closed task must reach a durable commit before the next queue head can be claimed.',
    };
  }
  if (input.pendingWindowTaskId) {
    return {
      state: 'pending-commit',
      mayClaimNext: false,
      pendingCommitTaskId: input.pendingWindowTaskId,
      reason: 'A task-scoped checkpoint commit window is still visible in the worktree.',
    };
  }
  return { state: 'ready-to-resume', mayClaimNext: true, pendingCommitTaskId: null, reason: 'No uncommitted checkpoint window remains.' };
}
