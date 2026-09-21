import { ATM_INDEX_FOREIGN_ACTIVE_STAGED } from '../git-index-ownership.ts';
import type { FrameworkCloseDirtyGuardReport } from '../tasks/scope-lock-diagnostics.ts';
import type { HistoricalClosePreflightBlocker, UnexpectedStagedTaskReport } from './historical-close-preflight.ts';

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

export function buildScopeDirtyBlocker(input: {
  taskId: string;
  actorId: string;
  dirtyGuard: FrameworkCloseDirtyGuardReport;
}): HistoricalClosePreflightBlocker | null {
  if (input.dirtyGuard.scopeTrackedDirtyFiles.length === 0) return null;
  return {
    id: 'scopeTrackedDirtyFiles',
    code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
    summary: 'In-scope delivery files are modified but not committed; close --write needs a governed delivery commit first.',
    files: input.dirtyGuard.scopeTrackedDirtyFiles,
    remediationChoices: [
      { id: 'commit-scoped-delivery', summary: 'Commit only task-scoped delivery files through the governed git commit lane.', requiredCommand: input.dirtyGuard.remediation.requiredCommand },
      { id: 'restore-accidental-drift', summary: 'If the drift is accidental, do not run raw git restore; request an explicit ATM destructive-override lease before any worktree mutation.', requiredCommand: `node atm.mjs git lease destructive-override --task ${input.taskId} --actor ${input.actorId} --paths ${input.dirtyGuard.scopeTrackedDirtyFiles.map((entry) => JSON.stringify(entry)).join(',')} --reason "<human-approved reason>" --json` }
    ],
    requiredCommand: input.dirtyGuard.remediation.requiredCommand
  };
}

export function buildGovernanceDirtyBlocker(input: { taskId: string; dirtyGuard: FrameworkCloseDirtyGuardReport }): HistoricalClosePreflightBlocker | null {
  if (input.dirtyGuard.governanceTrackedDirtyFiles.length === 0) return null;
  return {
    id: 'governanceTrackedDirtyFiles',
    code: 'ATM_TASK_CLOSE_DIRTY_WORKTREE',
    summary: `Task ${input.taskId} has uncommitted task-owned closure governance residue; close --write must not start a transaction until it is reconciled.`,
    files: input.dirtyGuard.governanceTrackedDirtyFiles,
    remediationChoices: [{ id: 'restore-accidental-drift', summary: 'Do not alter governance history manually. Use the guarded remediation supplied by the dirty-worktree diagnostic.', requiredCommand: input.dirtyGuard.remediation.requiredCommand }],
    requiredCommand: input.dirtyGuard.remediation.requiredCommand
  };
}

export function buildUnexpectedStagedBlocker(unexpectedStagedTasks: readonly UnexpectedStagedTaskReport[]): HistoricalClosePreflightBlocker | null {
  if (unexpectedStagedTasks.length === 0) return null;
  const taskIds = unexpectedStagedTasks.map((entry) => entry.taskId);
  const files = uniqueStrings(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
  return {
    id: 'unexpectedStagedTasks',
    code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
    summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
    files,
    taskIds,
    remediationChoices: unexpectedStagedTasks.map((entry) => ({ id: 'defer-foreign-staged' as const, summary: entry.restoreChoice, requiredCommand: entry.deferCommand })),
    requiredCommand: unexpectedStagedTasks[0]?.deferCommand ?? null
  };
}
