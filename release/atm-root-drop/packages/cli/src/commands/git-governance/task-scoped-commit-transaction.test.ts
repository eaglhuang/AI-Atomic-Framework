import assert from 'node:assert/strict';
import {
  executeTaskScopedCommitTransaction,
  TaskScopedCommitTransactionError,
} from './task-scoped-commit-transaction.ts';

const entries = [{ path: 'foreign.json', mode: '100644', blobId: 'a'.repeat(40) }];

{
  const events: string[] = [];
  const result = executeTaskScopedCommitTransaction(
    { taskId: 'TASK-CURRENT', leaseId: 'lease-current', foreignEntries: entries },
    {
      park: () => events.push('park'),
      commitCurrentTaskBundle: () => { events.push('commit'); return 'commit-sha'; },
      restore: () => events.push('restore'),
      recordRestoreFailure: () => events.push('record'),
    },
  );
  assert.equal(result.value, 'commit-sha');
  assert.deepEqual(result.restoredEntries, entries);
  assert.deepEqual(events, ['park', 'commit', 'restore']);
}

{
  const events: string[] = [];
  const commitFailure = new Error('commit failed');
  assert.throws(
    () => executeTaskScopedCommitTransaction(
      { taskId: 'TASK-CURRENT', leaseId: 'lease-current', foreignEntries: entries },
      {
        park: () => events.push('park'),
        commitCurrentTaskBundle: () => { events.push('commit'); throw commitFailure; },
        restore: () => events.push('restore'),
        recordRestoreFailure: () => events.push('record'),
      },
    ),
    (error: unknown) => error === commitFailure,
  );
  assert.deepEqual(events, ['park', 'commit', 'restore']);
}

{
  const events: string[] = [];
  const commitFailure = new Error('commit failed');
  const restoreFailure = new Error('restore failed');
  assert.throws(
    () => executeTaskScopedCommitTransaction(
      { taskId: 'TASK-CURRENT', leaseId: 'lease-current', foreignEntries: entries },
      {
        park: () => events.push('park'),
        commitCurrentTaskBundle: () => { events.push('commit'); throw commitFailure; },
        restore: () => { events.push('restore'); throw restoreFailure; },
        recordRestoreFailure: (input) => {
          events.push('record');
          assert.equal(input.commitError, commitFailure);
          assert.equal(input.restoreError, restoreFailure);
          assert.deepEqual(input.entries, entries);
        },
      },
    ),
    (error: unknown) => error instanceof TaskScopedCommitTransactionError
      && error.commitError === commitFailure
      && error.restoreError === restoreFailure,
  );
  assert.deepEqual(events, ['park', 'commit', 'restore', 'record']);
}

console.log('task-scoped-commit-transaction: exact restore is transactional');
