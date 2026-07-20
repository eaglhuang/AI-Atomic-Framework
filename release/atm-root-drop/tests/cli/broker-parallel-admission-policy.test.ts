import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultParallelAdmissionPolicy,
  resolveGatePolicy
} from '../../packages/core/src/broker/parallel-admission-policy.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-parallel-admission-'));
const digest = `sha256:${'a'.repeat(64)}`;

function runBroker(args: readonly string[]) {
  const stdout = execFileSync(process.execPath, ['atm.dev.mjs', 'broker', ...args, '--cwd', tmp, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  return JSON.parse(stdout);
}

try {
  const defaults = defaultParallelAdmissionPolicy();
  assert.equal(defaults.schemaId, 'atm.parallelAdmissionPolicy.v1');
  assert.equal(defaults.circuitBreakerEnabled, true);
  assert.equal(defaults.fallbackMode, 'queue-only');
  assert.ok(defaults.configDigest.startsWith('sha256:'));

  const r1 = resolveGatePolicy('R1_SAME_TASK_SECOND_LANE', defaults);
  const r2 = resolveGatePolicy('R2_DEPENDENCY_GATE', defaults);
  const r3 = resolveGatePolicy('R3_SHARED_WRITE_SURFACE', defaults);
  const r4 = resolveGatePolicy('R4_SHARED_SIDE_EFFECT', defaults);
  assert.equal(r1?.gateClass, 'hard-exception');
  assert.equal(r1?.canPolicyRelax, false);
  assert.equal(r2?.gateClass, 'hard-exception');
  assert.equal(r2?.canPolicyRelax, false);
  assert.equal(r3?.gateClass, 'ticketed-shared-write');
  assert.match(r3?.statusCommand ?? '', /broker parallel-admission status/);
  assert.match(r3?.recoveryCommand ?? '', /broker parallel-admission trip/);
  assert.equal(r4?.gateClass, 'ticketed-shared-write');
  assert.match(r4?.recoveryCommand ?? '', /broker parallel-admission reset/);

  const status = runBroker(['parallel-admission', 'status']);
  assert.equal(status.ok, true);
  assert.equal(status.evidence.policy.fallbackMode, 'queue-only');
  assert.equal(status.evidence.gateMatrix.length, 4);

  const set = runBroker(['parallel-admission', 'set', '--mode', 'observe', '--fallback-mode', 'fail-closed', '--scope-file', 'runner-sync']);
  assert.equal(set.evidence.policy.mode, 'observe');
  assert.equal(set.evidence.policy.fallbackMode, 'fail-closed');
  assert.deepEqual(set.evidence.policy.rolloutScope, ['runner-sync']);

  const tripped = runBroker(['parallel-admission', 'trip', '--actor', 'tester', '--reason', 'shared-write gate failed']);
  assert.equal(tripped.evidence.policy.tripped, true);
  assert.equal(tripped.evidence.policy.fallbackMode, 'queue-only');
  assert.equal(tripped.evidence.policy.tripReason, 'shared-write gate failed');

  const reset = runBroker(['parallel-admission', 'reset', '--actor', 'tester', '--receipt-digest', digest]);
  assert.equal(reset.evidence.policy.tripped, false);
  assert.equal(reset.evidence.policy.resetEvidenceDigest, digest);
  assert.match(reset.evidence.receipt.rollbackCommand, /parallel-admission set/);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('broker parallel admission policy ok');
