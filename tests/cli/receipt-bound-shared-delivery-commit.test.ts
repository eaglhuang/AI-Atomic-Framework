import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import {
  planSharedDeliveryCommit,
  type SharedDeliveryProvenanceInput
} from '../../packages/core/src/broker/shared-delivery-commit.ts';
import {
  ATM_BROKER_STEWARD_RECEIPT_INVALID,
  ATM_BROKER_STEWARD_RECEIPT_REQUIRED,
  SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID
} from '../../packages/core/src/broker/shared-write-provenance-policy.ts';

const now = '2026-07-23T00:00:00.000Z';
const sharedFile = 'packages/core/src/broker/shared-surface.ts';
const blobDigest = 'git-blob:abc123';
const canonicalRoot = path.join(os.tmpdir(), 'atm-shared-delivery-root');

let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
for (const [taskId, payloadDigest] of [['ATM-GOV-A', 'sha256:a'], ['ATM-GOV-B', 'sha256:b']] as const) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-commit',
    taskId,
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    payloadDigest,
    now
  }).document;
}

const decision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-commit',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(decision.verdict, 'batch-ready');

function stewardReceipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaId: SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID,
    receiptId: 'receipt-shared-delivery',
    canonicalRoot,
    baseSha: 'base-sha',
    headSha: 'head-sha',
    compositionPlanDigest: `sha256:${'1'.repeat(64)}`,
    candidateOutputDigest: `sha256:${'2'.repeat(64)}`,
    serializabilityProofDigest: `sha256:${'3'.repeat(64)}`,
    stewardId: 'steward-1',
    stewardRole: 'neutral-steward',
    memberTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
    fileDigests: { [sharedFile]: blobDigest },
    canonicalWriteCount: 1,
    semanticAuthorization: {
      schemaId: 'atm.stewardSemanticValidationReceipt.v1',
      candidateDigest: `sha256:${'1'.repeat(64)}`,
      outputDigest: `sha256:${'2'.repeat(64)}`,
      decisionVerdict: 'pass',
      ok: true
    },
    semanticBaseHeadSha: 'head-sha',
    semanticSealedSelectionSourceDigest: `sha256:${'4'.repeat(64)}`,
    semanticRunnerBuildDigest: `sha256:${'5'.repeat(64)}`,
    issuedAt: now,
    consumedAt: null,
    ...overrides
  };
}

function provenance(receipts: readonly unknown[]): SharedDeliveryProvenanceInput {
  return {
    canonicalRoot,
    baseSha: 'base-sha',
    headSha: 'head-sha',
    observedFiles: [{ path: sharedFile, writeClaimTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'], stagedBlobDigest: blobDigest }],
    receipts
  };
}

function plan(receipts: readonly unknown[] | null) {
  return planSharedDeliveryCommit({
    decision,
    scheduler,
    actorId: 'fixture-coordinator',
    manifestDigest: 'sha256:manifest',
    sealedBaseSha: 'base-sha',
    currentHeadSha: 'head-sha',
    expectedHeadSha: 'head-sha',
    claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
    validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
    stagedFiles: [sharedFile],
    fileSlices: { 'ATM-GOV-A': [sharedFile], 'ATM-GOV-B': [sharedFile] },
    temporaryIndexPath: path.join(os.tmpdir(), 'atm-shared-index'),
    provenance: receipts ? provenance(receipts) : null,
    now
  });
}

// No steward receipt: shared delivery must not emit a shared write receipt.
const missing = plan([]);
assert.equal(missing.ok, false);
assert.equal(missing.receipt, null);
assert.equal(missing.sharedWriteAdmission?.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_REQUIRED);
assert.ok(missing.blockers.some((entry) => entry.includes(ATM_BROKER_STEWARD_RECEIPT_REQUIRED)));

// Exact steward receipt: delivery proceeds and attribution is receipt-derived.
const admitted = plan([stewardReceipt()]);
assert.equal(admitted.ok, true, JSON.stringify(admitted.blockers));
assert.equal(admitted.receipt?.schemaId, 'atm.sharedWriteReceipt.v1');
assert.deepEqual(admitted.sharedWriteAdmission?.attributedTaskIds, ['ATM-GOV-A', 'ATM-GOV-B']);

// Caller-shaped attribution cannot substitute for receipt membership.
const attribution = plan([stewardReceipt({ memberTaskIds: ['ATM-GOV-A'] })]);
assert.equal(attribution.ok, false);
assert.equal(attribution.receipt, null);
assert.equal(attribution.sharedWriteAdmission?.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_INVALID);

// Stale HEAD and replayed receipts fail closed on the same code.
for (const overrides of [{ headSha: 'other-head' }, { consumedAt: now }, { canonicalWriteCount: 2 }]) {
  const blocked = plan([stewardReceipt(overrides)]);
  assert.equal(blocked.ok, false, `${JSON.stringify(overrides)} must fail closed`);
  assert.equal(blocked.sharedWriteAdmission?.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_INVALID);
}

// Disjoint single-claim slices remain unchanged by the receipt gate.
const disjoint = planSharedDeliveryCommit({
  decision,
  scheduler,
  actorId: 'fixture-coordinator',
  manifestDigest: 'sha256:manifest',
  sealedBaseSha: 'base-sha',
  currentHeadSha: 'head-sha',
  expectedHeadSha: 'head-sha',
  claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  stagedFiles: ['a.ts', 'b.ts'],
  fileSlices: { 'ATM-GOV-A': ['a.ts'], 'ATM-GOV-B': ['b.ts'] },
  temporaryIndexPath: path.join(os.tmpdir(), 'atm-shared-index'),
  provenance: {
    canonicalRoot,
    baseSha: 'base-sha',
    headSha: 'head-sha',
    observedFiles: [
      { path: 'a.ts', writeClaimTaskIds: ['ATM-GOV-A'], stagedBlobDigest: blobDigest },
      { path: 'b.ts', writeClaimTaskIds: ['ATM-GOV-B'], stagedBlobDigest: blobDigest }
    ],
    receipts: []
  },
  now
});
assert.equal(disjoint.ok, true, JSON.stringify(disjoint.blockers));
assert.deepEqual(disjoint.sharedWriteAdmission?.sharedFiles, []);

console.log('receipt-bound-shared-delivery-commit.test passed');
