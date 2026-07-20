import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import { planSharedDeliveryCommit } from '../../packages/core/src/broker/shared-delivery-commit.ts';
import { planSharedDeliverySaga } from '../../packages/core/src/broker/shared-delivery-saga.ts';

const now = '2026-07-20T00:00:00.000Z';
let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-shared',
    taskId,
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId.toLowerCase()}`,
    now
  }).document;
}

const decision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-shared',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(decision.verdict, 'batch-ready');

const commitPlan = planSharedDeliveryCommit({
  decision,
  scheduler,
  actorId: 'fixture-coordinator',
  manifestDigest: 'sha256:manifest',
  sealedBaseSha: 'base-sha',
  currentHeadSha: 'head-sha',
  expectedHeadSha: 'head-sha',
  claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  stagedFiles: ['a.txt', 'b.txt'],
  fileSlices: {
    'ATM-GOV-A': ['a.txt'],
    'ATM-GOV-B': ['b.txt']
  },
  temporaryIndexPath: 'temp-index',
  now
});
assert.equal(commitPlan.ok, true);

const saga = planSharedDeliverySaga({
  decision,
  scheduler,
  expectedHeadSha: 'head-sha',
  actualHeadSha: 'head-sha',
  sharedWriteReceipt: commitPlan.receipt,
  fileSlices: {
    'ATM-GOV-A': ['a.txt'],
    'ATM-GOV-B': ['b.txt']
  },
  validatorRefs: {
    'ATM-GOV-A': ['npm run typecheck'],
    'ATM-GOV-B': ['npm run validate:cli']
  },
  semanticRefs: {
    'ATM-GOV-A': ['semantic:valid'],
    'ATM-GOV-B': ['semantic:valid']
  }
});

assert.equal(saga.ok, true);
assert.equal(saga.receipt?.schemaId, 'atm.sharedDeliverySagaReceipt.v1');
assert.deepEqual(saga.receipt?.taskIds, ['ATM-GOV-A', 'ATM-GOV-B']);
assert.equal(saga.receipt?.recoveryAction, 'none');
assert.equal(saga.receipt?.exactlyOnce, true);
assert.ok(saga.journal.completedPhases.indexOf('verify-expected-head') < saga.journal.phases.indexOf('cas-publish'));
assert.equal(saga.receipt?.memberSlices[0]?.validatorRefs.length, 1);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync('schemas/governance/shared-delivery-saga.schema.json', 'utf8'));
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
assert.equal(ajv.validate(schema, saga.receipt), true, JSON.stringify(ajv.errors));

const missingValidator = planSharedDeliverySaga({
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
    'ATM-GOV-A': ['npm run typecheck'],
    'ATM-GOV-B': []
  }
});
assert.equal(missingValidator.ok, false);
assert.match(missingValidator.blockers.join('\n'), /ATM-GOV-B has no validator refs/);

console.log('[shared-delivery-saga-ordering:test] ok');
