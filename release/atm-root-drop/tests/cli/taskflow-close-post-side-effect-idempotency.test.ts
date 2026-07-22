import assert from 'node:assert/strict';
import {
  buildCloseSideEffectIdempotencyKey,
  reconcileCloseSideEffects
} from '../../packages/cli/src/commands/taskflow/close-side-effect-reconcile.ts';

const taskId = 'ATM-GOV-0236';
const actorId = 'captain';
const beforeDigest = 'sha256:before';
const afterDigest = 'sha256:after';
const idempotencyKey = buildCloseSideEffectIdempotencyKey({
  taskId,
  actorId,
  sideEffect: 'planning-closeback',
  beforeDigest
});

assert.match(idempotencyKey, /ATM-GOV-0236/);
assert.match(idempotencyKey, /planning-closeback/);
assert.match(idempotencyKey, /sha256:before/);

const preSideEffectDrift = reconcileCloseSideEffects({
  taskId,
  actorId,
  planningSourceIdentityDrift: true,
  sideEffects: [
    { name: 'live-ledger', status: 'pending', idempotencyKey: 'pending-ledger', beforeDigest, afterDigest: null }
  ]
});
assert.equal(preSideEffectDrift.ok, false);
assert.equal(preSideEffectDrift.disposition, 'fail-closed');
assert.equal(preSideEffectDrift.code, 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT');

const postSideEffectDrift = reconcileCloseSideEffects({
  taskId,
  actorId,
  planningSourceIdentityDrift: true,
  sideEffects: [
    { name: 'live-ledger', status: 'completed', idempotencyKey: 'ledger-key', beforeDigest, afterDigest },
    { name: 'target-commit', status: 'completed', idempotencyKey: 'target-key', beforeDigest, afterDigest, commitSha: 'abc123' },
    { name: 'planning-closeback', status: 'completed', idempotencyKey, beforeDigest, afterDigest, ref: 'main' }
  ]
});

assert.equal(postSideEffectDrift.ok, true);
assert.equal(postSideEffectDrift.disposition, 'reconciled');
assert.equal(postSideEffectDrift.replayAllowed, false);
assert.equal(postSideEffectDrift.completedSideEffects.length, 3);
assert.doesNotMatch(postSideEffectDrift.recoveryCommand, /\b(commit|close|push)\b/);

console.log('[taskflow-close-post-side-effect-idempotency] ok');
