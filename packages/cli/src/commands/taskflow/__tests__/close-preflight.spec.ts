import assert from 'node:assert/strict';
import { inspectPlanningAuthorityDelivery, extractTaskflowDeclaredFiles } from '../close-preflight.ts';

const taskDocument = {
  workItemId: 'TASK-PLAN-0001',
  closureAuthority: 'planning_repo',
  scopePaths: ['src/app.ts'],
  deliverables: ['src/app.ts'],
  targetAllowedFiles: ['docs/shared.md'],
  claim: {
    files: ['packages/cli/src/runtime-scope.ts']
  },
  source: {
    planPath: 'C:/repo/planning/docs/tasks/TASK-PLAN-0001.task.md'
  }
};

assert.deepEqual(extractTaskflowDeclaredFiles(process.cwd(), 'TASK-PLAN-0001', taskDocument), [
  'docs/shared.md',
  'packages/cli/src/runtime-scope.ts',
  'src/app.ts'
]);

const gate = inspectPlanningAuthorityDelivery({
  cwd: process.cwd(),
  taskDocument,
  historicalDeliveryRefs: []
});

assert.equal(gate.required, true);
assert.equal(gate.ok, false);
assert.ok(Boolean(gate.reason));

console.log('ok: close preflight spec passed');
