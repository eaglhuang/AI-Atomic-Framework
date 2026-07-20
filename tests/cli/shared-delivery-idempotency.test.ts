import assert from 'node:assert/strict';
import { planSharedDeliverySaga, type SharedDeliverySagaSideEffect } from '../../packages/core/src/broker/shared-delivery-saga.ts';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

let scheduler = createEmptyWaveBrokerSchedulerDocument('2026-07-20T00:00:00.000Z');
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-idempotent',
    taskId,
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId === 'ATM-GOV-A' ? '1'.repeat(64) : '2'.repeat(64)}`,
    now: '2026-07-20T00:00:00.000Z'
  }).document;
}

const decision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-idempotent',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  collectionTimeoutMs: 0
});
assert.equal(decision.verdict, 'batch-ready');

const effects: SharedDeliverySagaSideEffect[] = [];
for (let attempt = 1; attempt <= 3; attempt += 1) {
  effects.push({
    operationId: 'commit:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    kind: 'commit',
    state: attempt === 1 ? 'acknowledged' : 'replayed',
    attempt,
    acknowledged: true,
    compensation: 'governed-revert-required'
  });
}

const plan = planSharedDeliverySaga({
  decision,
  scheduler,
  expectedHeadSha: '0123456789012345678901234567890123456789',
  actualHeadSha: '0123456789012345678901234567890123456789',
  fileSlices: {
    'ATM-GOV-A': ['space dir/quoted "台灣" path xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.ts'],
    'ATM-GOV-B': ['other dir/long path yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy.ts']
  },
  validatorRefs: { 'ATM-GOV-A': ['validator:pass'], 'ATM-GOV-B': ['validator:pass'] },
  attemptedSideEffects: effects,
  killpoint: 'after-commit-object'
});

assert.equal(plan.ok, true);
assert.equal(plan.receipt?.exactlyOnce, true);
assert.equal(plan.receipt?.sideEffects.length, 1);
assert.equal(plan.receipt?.sideEffects[0].state, 'replayed');
assert.equal(plan.receipt?.recoveryAction, 'compensate');

console.log('[shared-delivery-idempotency:test] ok');
