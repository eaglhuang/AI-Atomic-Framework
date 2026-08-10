// TASK-MAO-0017: tests for the runner version stream state machine.
import assert from 'node:assert/strict';
import {
  createRunnerVersionStream,
  transitionRunnerVersion,
  acquireRunnerVersionLease
} from '../runner-version-state.ts';
import { classifyRunnerAffectingPaths, isRunnerGeneratedOutputPath } from '../runner-version-contract.ts';

function testInitialStateIsInDev() {
  const s = createRunnerVersionStream('runner-v0.x');
  assert.equal(s.state, 'in-dev');
}

function testHappyPathLifecycle() {
  let s = createRunnerVersionStream('runner-v0.x');
  s = transitionRunnerVersion(s, 'cut-rc', 'steward').record;
  assert.equal(s.state, 'rc-stabilizing');
  s = transitionRunnerVersion(s, 'freeze-rc', 'steward').record;
  assert.equal(s.state, 'rc-frozen');
  s = transitionRunnerVersion(s, 'publish', 'steward').record;
  assert.equal(s.state, 'published');
  s = transitionRunnerVersion(s, 'retire', 'steward').record;
  assert.equal(s.state, 'retired');
  assert.equal(s.history.length, 4);
}

function testIllegalTransitionFailsClosed() {
  const s = createRunnerVersionStream('x');
  const r = transitionRunnerVersion(s, 'publish', 'steward');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not allowed/);
}

function testRollbackReturnsToInDev() {
  let s = createRunnerVersionStream('x');
  s = transitionRunnerVersion(s, 'cut-rc', 'a').record;
  s = transitionRunnerVersion(s, 'rollback-rc', 'a').record;
  assert.equal(s.state, 'in-dev');
}

function testLeaseAllowedOnlyOnLiveStates() {
  let s = createRunnerVersionStream('x');
  const ok = acquireRunnerVersionLease(s, 'agent', 60);
  assert.equal(ok.ok, true);
  s = transitionRunnerVersion(s, 'cut-rc', 'a').record;
  s = transitionRunnerVersion(s, 'freeze-rc', 'a').record;
  const denied = acquireRunnerVersionLease(s, 'agent', 60);
  assert.equal(denied.ok, false);
}

function testGeneratedRunnerOutputsDoNotInvalidateTheirOwnSeal() {
  assert.equal(isRunnerGeneratedOutputPath('packages/cli/dist/commands/taskflow/implementation.js'), true);
  assert.equal(isRunnerGeneratedOutputPath('packages/core/dist/broker/runner-version-contract.js'), true);
  const classification = classifyRunnerAffectingPaths([
    'packages/cli/dist/commands/taskflow/implementation.js',
    'packages/cli/src/commands/taskflow/implementation.ts'
  ]);
  assert.deepEqual(classification.runnerAffecting, ['packages/cli/src/commands/taskflow/implementation.ts']);
  assert.deepEqual(classification.nonRunnerAffecting, ['packages/cli/dist/commands/taskflow/implementation.js']);
}

testInitialStateIsInDev();
testHappyPathLifecycle();
testIllegalTransitionFailsClosed();
testRollbackReturnsToInDev();
testLeaseAllowedOnlyOnLiveStates();
testGeneratedRunnerOutputsDoNotInvalidateTheirOwnSeal();

console.log('runner version state tests: ok');
