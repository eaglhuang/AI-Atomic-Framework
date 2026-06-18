// TASK-MAO-0017: tests for runner version stream lease semantics.
import assert from 'node:assert/strict';
import {
  createRunnerVersionStream,
  acquireRunnerVersionLease,
  transitionRunnerVersion
} from '../../packages/core/src/broker/runner-version-state.ts';

function testLeaseTtlIsRespected() {
  const s = createRunnerVersionStream('x');
  const now = '2026-01-01T00:00:00.000Z';
  const r = acquireRunnerVersionLease(s, 'actor', 30, now);
  assert.equal(r.ok, true);
  assert.equal(r.record.lease.heldBy, 'actor');
  assert.equal(r.record.lease.heldUntil, '2026-01-01T00:00:30.000Z');
}

function testLeaseDeniedForPublished() {
  let s = createRunnerVersionStream('x');
  for (const t of ['cut-rc', 'freeze-rc', 'publish'] as const) {
    s = transitionRunnerVersion(s, t, 'steward').record;
  }
  const r = acquireRunnerVersionLease(s, 'actor', 30);
  assert.equal(r.ok, false);
  assert.match(r.reason, /published/);
}

function testLeaseGrantDoesNotChangeState() {
  const s = createRunnerVersionStream('x');
  const r = acquireRunnerVersionLease(s, 'actor', 30);
  assert.equal(r.record.state, 'in-dev');
}

testLeaseTtlIsRespected();
testLeaseDeniedForPublished();
testLeaseGrantDoesNotChangeState();

console.log('runner version lease tests: ok');
