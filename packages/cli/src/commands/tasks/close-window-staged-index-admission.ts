export interface CloseWindowStagedIndexAdmission {
  readonly ok: boolean;
  readonly blockedCode: string | null;
  readonly blockedSummary: string | null;
}

export function evaluateCloseWindowStagedIndexAdmission(input: {
  readonly taskId: string;
  readonly activeLockTaskId: string | null;
  readonly unexpectedStagedFiles: readonly string[];
  readonly unexpectedStagedTaskIds: readonly string[];
  readonly deferForeignStaged: boolean;
}): CloseWindowStagedIndexAdmission {
  if (input.activeLockTaskId && input.activeLockTaskId !== input.taskId) {
    return { ok: false, blockedCode: 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED', blockedSummary: `Close window staged-index lock is already held by ${input.activeLockTaskId}; wait for release or inspect tasks status before staging.` };
  }
  if (input.unexpectedStagedFiles.length > 0 && !input.deferForeignStaged) {
    return { ok: false, blockedCode: 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS', blockedSummary: input.unexpectedStagedTaskIds.length > 0
      ? `Close window blocked by foreign staged tasks (${input.unexpectedStagedTaskIds.join(', ')}); defer explicitly or wait for the other agent to commit.`
      : 'Close window blocked by staged entries outside the governed bundle; defer explicitly or reconcile the index before closing.' };
  }
  return { ok: true, blockedCode: null, blockedSummary: null };
}
