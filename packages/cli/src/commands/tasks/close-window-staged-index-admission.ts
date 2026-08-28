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
  /**
   * Staged paths a dry-run drain proved are this repository's own unreconciled
   * commits rather than another lane's work. Absent means unclassified, which
   * keeps the original foreign-staged treatment for every legacy caller.
   */
  readonly provenResidueFiles?: readonly string[];
  readonly residueDrainCommand?: string | null;
}): CloseWindowStagedIndexAdmission {
  if (input.activeLockTaskId && input.activeLockTaskId !== input.taskId) {
    return { ok: false, blockedCode: 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED', blockedSummary: `Close window staged-index lock is already held by ${input.activeLockTaskId}; wait for release or inspect tasks status before staging.` };
  }
  if (input.unexpectedStagedFiles.length > 0 && !input.deferForeignStaged) {
    const residue = new Set(input.provenResidueFiles ?? []);
    const foreignStagedFiles = input.unexpectedStagedFiles.filter((filePath) => !residue.has(filePath));
    // Deferring proven residue parks a snapshot and restores it byte-identically
    // on release, so it recreates the debt instead of clearing it. When nothing
    // foreign is staged, the honest instruction is to drain, not to defer.
    if (foreignStagedFiles.length === 0 && residue.size > 0) {
      return { ok: false, blockedCode: 'ATM_CLOSE_WINDOW_UNRECONCILED_RESIDUE', blockedSummary:
        `Close window blocked by ${residue.size} staged path(s) that are this repository's own unreconciled commits, not foreign work; drain the recorded reconciliation debt${input.residueDrainCommand ? ` (${input.residueDrainCommand})` : ''} rather than deferring it.` };
    }
    return { ok: false, blockedCode: 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS', blockedSummary: (input.unexpectedStagedTaskIds.length > 0
      ? `Close window blocked by foreign staged tasks (${input.unexpectedStagedTaskIds.join(', ')}); defer explicitly or wait for the other agent to commit.`
      : 'Close window blocked by staged entries outside the governed bundle; defer explicitly or reconcile the index before closing.')
      + (residue.size > 0 ? ` ${residue.size} of the staged path(s) are provably this repository's own unreconciled commits and can be drained separately.` : '') };
  }
  return { ok: true, blockedCode: null, blockedSummary: null };
}
