import assert from 'node:assert/strict';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import { planSharedDeliverySaga, type SharedDeliverySagaSideEffect } from '../../packages/core/src/broker/shared-delivery-saga.ts';

const now = '2026-07-20T00:00:00.000Z';
let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-recover',
    taskId,
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId.toLowerCase()}`,
    now
  }).document;
}
const decision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-recover',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});

const base = {
  decision,
  scheduler,
  expectedHeadSha: 'head-sha',
  actualHeadSha: 'head-sha',
  sharedWriteReceipt: null,
  fileSlices: {
    'ATM-GOV-A': ['a.txt'],
    'ATM-GOV-B': ['b.txt']
  },
  validatorRefs: {
    'ATM-GOV-A': ['validator:a'],
    'ATM-GOV-B': ['validator:b']
  }
};

const afterUpdateRef = planSharedDeliverySaga({
  ...base,
  killpoint: 'after-update-ref',
  attemptedSideEffects: [{
    operationId: 'update-ref:head-sha->commit-sha',
    kind: 'update-ref',
    state: 'acknowledged',
    attempt: 1,
    acknowledged: true,
    compensation: 'governed-revert-required'
  }]
});
assert.equal(afterUpdateRef.ok, true);
assert.equal(afterUpdateRef.receipt?.recoveryAction, 'replay-receipt');
assert.equal(afterUpdateRef.journal.terminalState, 'recovered');

const duplicateEffects: SharedDeliverySagaSideEffect[] = [
  {
    operationId: 'push:origin/main',
    kind: 'push',
    state: 'acknowledged',
    attempt: 1,
    acknowledged: true,
    compensation: 'reconcile-remote'
  },
  {
    operationId: 'push:origin/main',
    kind: 'push',
    state: 'acknowledged',
    attempt: 2,
    acknowledged: true,
    compensation: 'reconcile-remote'
  }
];
const duplicate = planSharedDeliverySaga({
  ...base,
  killpoint: 'after-push',
  attemptedSideEffects: duplicateEffects
});
assert.equal(duplicate.ok, false);
assert.match(duplicate.blockers.join('\n'), /duplicate acknowledged side effect/);

const staleHead = planSharedDeliverySaga({
  ...base,
  actualHeadSha: 'foreign-head'
});
assert.equal(staleHead.ok, false);
assert.match(staleHead.blockers.join('\n'), /actual HEAD drifted/);

console.log('[shared-delivery-saga-crash-recovery:test] ok');
