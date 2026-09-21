import assert from 'node:assert/strict';
import { resolveTaskBoundCommitFiles } from './commit-bundle-selection.ts';
import { mergeCandidateCommitEnv } from './commit-attempt-boundary.ts';

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
  mergeCandidateCommitEnv(
    {
      ATM_COMMIT_ACTOR_ID: 'codex-captain',
      ATM_COMMIT_TASK_ID: 'ATM-GOV-0287',
      ATM_COMMIT_SESSION_ID: '',
    },
    {
      GIT_INDEX_FILE: 'candidate-index',
      ATM_COMMIT_ACTOR_ID: 'stale-ambient-actor',
      ATM_COMMIT_TASK_ID: '',
      ATM_COMMIT_SESSION_ID: 'stale-ambient-session',
    },
  ),
  {
    GIT_INDEX_FILE: 'candidate-index',
    ATM_COMMIT_ACTOR_ID: 'codex-captain',
    ATM_COMMIT_TASK_ID: 'ATM-GOV-0287',
    ATM_COMMIT_SESSION_ID: '',
  },
  'the isolated candidate index may supply GIT_INDEX_FILE but must not override wrapper-bound attribution',
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
