// TASK-MAO-0031: tests for the coordinator-only git / closeout guard. Only the
// coordinator role may perform git writes, task closeout, or checkpoint; all
// other Wave Mode roles fail closed. The existing hooks / batch checkpoint /
// taskflow close remain the lifecycle authority — this guard only gates which
// role may invoke them.
import assert from 'node:assert/strict';
import {
  assertCoordinatorOnly,
  type WaveRole,
  type WavePrivilegedAction
} from '../../../../cli/src/commands/team-wave.ts';

const privilegedActions: WavePrivilegedAction[] = ['git-write', 'task-closeout', 'checkpoint'];
const nonCoordinatorRoles: WaveRole[] = ['worker', 'validator', 'reviewer'];

function testCoordinatorMayPerformAllPrivilegedActions() {
  for (const action of privilegedActions) {
    const result = assertCoordinatorOnly('coordinator', action);
    assert.equal(result.allowed, true, `coordinator should be allowed ${action}`);
  }
}

function testNonCoordinatorRolesAreFailedClosed() {
  for (const role of nonCoordinatorRoles) {
    for (const action of privilegedActions) {
      const result = assertCoordinatorOnly(role, action);
      assert.equal(result.allowed, false, `${role} must not perform ${action}`);
      assert.match(result.reason, /coordinator/);
    }
  }
}

testCoordinatorMayPerformAllPrivilegedActions();
testNonCoordinatorRolesAreFailedClosed();

console.log('team wave closeout guard tests: ok');
