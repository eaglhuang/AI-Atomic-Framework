export interface TaskScopedCommitTransactionEntry {
  readonly path: string;
  readonly mode: string;
  readonly blobId: string;
}

export interface TaskScopedCommitTransactionRequest {
  readonly taskId: string;
  readonly leaseId: string | null;
  readonly foreignEntries: readonly TaskScopedCommitTransactionEntry[];
}

export interface TaskScopedCommitTransactionResult<T> {
  readonly value: T;
  readonly restoredEntries: readonly TaskScopedCommitTransactionEntry[];
}

export interface TaskScopedCommitTransactionPorts<T> {
  readonly park: (entries: readonly TaskScopedCommitTransactionEntry[]) => void;
  readonly commitCurrentTaskBundle: () => T;
  readonly restore: (entries: readonly TaskScopedCommitTransactionEntry[]) => void;
  readonly recordRestoreFailure: (input: {
    readonly taskId: string;
    readonly leaseId: string | null;
    readonly entries: readonly TaskScopedCommitTransactionEntry[];
    readonly commitError: unknown;
    readonly restoreError: unknown;
  }) => void;
}

export class TaskScopedCommitTransactionError extends Error {
  readonly code = 'ATM_GIT_INDEX_RESTORE_FAILED' as const;
  readonly commitError: unknown;
  readonly restoreError: unknown;

  constructor(input: { readonly commitError: unknown; readonly restoreError: unknown }) {
    super('Task-scoped commit could not restore its authorized foreign index entries.');
    this.name = 'TaskScopedCommitTransactionError';
    this.commitError = input.commitError;
    this.restoreError = input.restoreError;
  }
}

/**
 * Shared transaction boundary for ordinary task commits and close bundles.
 * Callers supply already-authorized entries; this module owns exact
 * park/restore lifecycle and never broadens the index write set.
 */
export function executeTaskScopedCommitTransaction<T>(
  request: TaskScopedCommitTransactionRequest,
  ports: TaskScopedCommitTransactionPorts<T>
): TaskScopedCommitTransactionResult<T> {
  const entries = [...request.foreignEntries];
  if (entries.length > 0) ports.park(entries);

  let value: T | undefined;
  let commitError: unknown = null;
  let commitFailed = false;
  try {
    value = ports.commitCurrentTaskBundle();
  } catch (error) {
    commitFailed = true;
    commitError = error;
  }

  try {
    if (entries.length > 0) ports.restore(entries);
  } catch (restoreError) {
    ports.recordRestoreFailure({ taskId: request.taskId, leaseId: request.leaseId, entries, commitError, restoreError });
    throw new TaskScopedCommitTransactionError({ commitError, restoreError });
  }

  if (commitFailed) throw commitError;
  return { value: value as T, restoredEntries: entries };
}
