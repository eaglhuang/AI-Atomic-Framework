import assert from 'node:assert/strict';
import {
  resolveTaskflowDeclaredFiles,
  resolveTaskflowEffectiveDeliverables
} from '../task-scope.ts';

const taskId = 'TASK-SCOPE-RUNTIME-0001';
const runtimeScopedTask = {
  deliverables: [
    '.atm/history/evidence/',
    '.atm/history/task-events/',
    '.atm/history/tasks/'
  ],
  scopePaths: [
    '.atm/history/evidence/TASK-SCOPE-RUNTIME-0001.*',
    '.atm/history/task-events/TASK-SCOPE-RUNTIME-0001/**',
    '.atm/history/tasks/TASK-SCOPE-RUNTIME-0001.json'
  ],
  taskDirectionLock: {
    allowedFiles: [
      '.atm/history/evidence/TASK-SCOPE-RUNTIME-0001.*',
      '.atm/history/task-events/TASK-SCOPE-RUNTIME-0001/**',
      '.atm/history/tasks/TASK-SCOPE-RUNTIME-0001.json'
    ]
  },
  claim: {
    files: [
      '.atm/history/evidence/TASK-SCOPE-RUNTIME-0001.*',
      '.atm/history/task-events/TASK-SCOPE-RUNTIME-0001/**',
      '.atm/history/tasks/TASK-SCOPE-RUNTIME-0001.json'
    ]
  }
};

const runtimeDeclared = resolveTaskflowDeclaredFiles(process.cwd(), taskId, runtimeScopedTask);
assert.deepEqual(runtimeDeclared, runtimeScopedTask.taskDirectionLock.allowedFiles,
  'an active direction lock must constrain broad static deliverable directories');
assert.equal(runtimeDeclared.includes('.atm/history/tasks/'), false,
  'a broad static history directory must not re-enter a runtime-scoped close');
assert.equal(runtimeDeclared.some((entry) => entry.includes('TASK-PRF-0008')), false,
  'an unrelated task cannot enter the candidate set through a broad static deliverable');

const runtimeDeliverables = resolveTaskflowEffectiveDeliverables(process.cwd(), taskId, runtimeScopedTask);
assert.deepEqual(runtimeDeliverables, [],
  'runtime-only ATM history scope is not a source deliverable after the active lock constrains it');

const unclaimedTask = {
  deliverables: ['docs/reports/'],
  scopePaths: ['docs/reports/**']
};
assert.deepEqual(
  resolveTaskflowDeclaredFiles(process.cwd(), 'TASK-SCOPE-STATIC-0001', unclaimedTask),
  ['docs/reports/', 'docs/reports/**'],
  'static declarations remain the pre-claim fallback when no runtime scope exists'
);

console.log('[task-scope-runtime-authority.spec] ok');
