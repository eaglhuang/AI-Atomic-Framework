import assert from 'node:assert/strict';
import { isTaskCloseGovernanceCriticalPath } from '../critical-path-gate.js';
const taskId = 'TASK-RFT-0003';
assert.equal(isTaskCloseGovernanceCriticalPath('.atm/history/tasks/TASK-RFT-0003.json', taskId), true);
assert.equal(isTaskCloseGovernanceCriticalPath('packages/cli/src/commands/framework-development.ts', taskId), false);
assert.equal(isTaskCloseGovernanceCriticalPath('.atm/history/tasks/TASK-RFT-0004.json', taskId), false);
assert.equal(isTaskCloseGovernanceCriticalPath('not-atm/history/tasks/TASK-RFT-0003.json', taskId), false);
console.log('[framework-development-critical-path-gate:test] ok');
