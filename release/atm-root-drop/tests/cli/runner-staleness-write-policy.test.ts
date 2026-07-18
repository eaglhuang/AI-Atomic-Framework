import assert from 'node:assert/strict';
import {
  assertRunnerFreshForWriteAction,
  classifyRunnerStaleWriteAction
} from '../../packages/cli/src/commands/framework-development.ts';

assert.equal(classifyRunnerStaleWriteAction('tasks-import-write'), 'ledger-only');
assert.equal(classifyRunnerStaleWriteAction('tasks-create'), 'ledger-only');
assert.equal(classifyRunnerStaleWriteAction('tasks-mirror'), 'ledger-only');
assert.equal(classifyRunnerStaleWriteAction('tasks-scope-add'), 'ledger-only');
assert.equal(classifyRunnerStaleWriteAction('tasks-scope-repair-deliverables'), 'ledger-only');
assert.equal(classifyRunnerStaleWriteAction('tasks-close'), 'behavioral');
assert.equal(classifyRunnerStaleWriteAction('tasks-reconcile'), 'behavioral');
assert.equal(classifyRunnerStaleWriteAction('tasks-repair-closure-write'), 'behavioral');

const freshLedgerGate = assertRunnerFreshForWriteAction({
  cwd: process.cwd(),
  action: 'tasks-import-write',
  allowStaleRunner: false
});
assert.equal(freshLedgerGate.policy, 'ledger-only');

console.log('[runner-staleness-write-policy.test] ok');
