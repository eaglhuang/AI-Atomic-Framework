import assert from 'node:assert/strict';
import { resolveTaskBoundCommitFiles } from './commit-bundle-selection.ts';

const taskBundle = { commitFiles: ['src/current.ts'] };
const frameworkFiles = ['foreign/staged.ts'];

assert.deepEqual(
  resolveTaskBoundCommitFiles({
    taskId: 'TASK-CURRENT',
    taskDocument: { workItemId: 'TASK-CURRENT' },
    taskScopedBundleReport: taskBundle,
    frameworkClaimCommitFiles: frameworkFiles,
  }),
  ['src/current.ts'],
  'WIP/session bypass must retain the task-scoped sealed candidate',
);

assert.deepEqual(
  resolveTaskBoundCommitFiles({
    taskId: null,
    taskDocument: null,
    taskScopedBundleReport: taskBundle,
    frameworkClaimCommitFiles: frameworkFiles,
  }),
  frameworkFiles,
  'framework commits retain their own explicit candidate surface',
);

console.log('commit-execution: task candidate wins over WIP session bypass');
