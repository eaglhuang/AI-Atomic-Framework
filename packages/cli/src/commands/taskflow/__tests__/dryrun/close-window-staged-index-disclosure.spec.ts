import assert from 'node:assert/strict';
import { evaluateCloseWindowStagedIndexAdmission } from '../../../tasks/close-window-staged-index-admission.ts';

const foreign = evaluateCloseWindowStagedIndexAdmission({ taskId: 'TASK-A', activeLockTaskId: null,
  unexpectedStagedFiles: ['foreign.ts'], unexpectedStagedTaskIds: ['TASK-B'], deferForeignStaged: false });
assert.equal(foreign.blockedCode, 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS');
assert.match(foreign.blockedSummary ?? '', /TASK-B/);

const locked = evaluateCloseWindowStagedIndexAdmission({ taskId: 'TASK-A', activeLockTaskId: 'TASK-B',
  unexpectedStagedFiles: [], unexpectedStagedTaskIds: [], deferForeignStaged: false });
assert.equal(locked.blockedCode, 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED');

const deferred = evaluateCloseWindowStagedIndexAdmission({ taskId: 'TASK-A', activeLockTaskId: null,
  unexpectedStagedFiles: ['foreign.ts'], unexpectedStagedTaskIds: ['TASK-B'], deferForeignStaged: true });
assert.equal(deferred.ok, true);

const clean = evaluateCloseWindowStagedIndexAdmission({ taskId: 'TASK-A', activeLockTaskId: null,
  unexpectedStagedFiles: [], unexpectedStagedTaskIds: [], deferForeignStaged: false });
assert.equal(clean.ok, true);

console.log('[close-window-staged-index-disclosure.spec] ok');
