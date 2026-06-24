import assert from 'node:assert/strict';
import { inspectPlanningAuthorityDelivery, extractTaskflowDeclaredFiles } from '../close-preflight.js';
const taskDocument = {
    closureAuthority: 'planning_repo',
    scopePaths: ['src/app.ts'],
    deliverables: ['src/app.ts'],
    source: {
        planPath: 'C:/repo/planning/docs/tasks/TASK-PLAN-0001.task.md'
    }
};
assert.deepEqual(extractTaskflowDeclaredFiles(taskDocument), ['src/app.ts']);
const gate = inspectPlanningAuthorityDelivery({
    cwd: process.cwd(),
    taskDocument,
    historicalDeliveryRefs: []
});
assert.equal(gate.required, true);
assert.equal(gate.ok, false);
assert.ok(Boolean(gate.reason));
console.log('ok: close preflight spec passed');
