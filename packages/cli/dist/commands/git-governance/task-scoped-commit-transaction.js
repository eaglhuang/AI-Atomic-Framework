export class TaskScopedCommitTransactionError extends Error {
    code = 'ATM_GIT_INDEX_RESTORE_FAILED';
    commitError;
    restoreError;
    constructor(input) {
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
export function executeTaskScopedCommitTransaction(request, ports) {
    const entries = [...request.foreignEntries];
    if (entries.length > 0)
        ports.park(entries);
    let value;
    let commitError = null;
    let commitFailed = false;
    try {
        value = ports.commitCurrentTaskBundle();
    }
    catch (error) {
        commitFailed = true;
        commitError = error;
    }
    try {
        if (entries.length > 0)
            ports.restore(entries);
    }
    catch (restoreError) {
        ports.recordRestoreFailure({ taskId: request.taskId, leaseId: request.leaseId, entries, commitError, restoreError });
        throw new TaskScopedCommitTransactionError({ commitError, restoreError });
    }
    if (commitFailed)
        throw commitError;
    return { value: value, restoredEntries: entries };
}
