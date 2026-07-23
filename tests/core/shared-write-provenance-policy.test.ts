import assert from 'node:assert/strict';

import {
  ATM_BROKER_STEWARD_RECEIPT_INVALID,
  ATM_BROKER_STEWARD_RECEIPT_REQUIRED,
  SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID,
  evaluateSharedWriteAdmission,
  isSharedCanonicalWrite,
  type SharedWriteProvenanceReceipt
} from '../../packages/core/src/broker/shared-write-provenance-policy.ts';

const canonicalRoot = '/repo';
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const sharedPath = 'packages/core/src/shared.ts';
const blobDigest = 'git-blob:1234567890abcdef1234567890abcdef12345678';

function receipt(overrides: Partial<SharedWriteProvenanceReceipt> = {}): SharedWriteProvenanceReceipt {
  return {
    schemaId: SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID,
    receiptId: 'receipt-1',
    canonicalRoot,
    baseSha,
    headSha,
    compositionPlanDigest: `sha256:${'1'.repeat(64)}`,
    candidateOutputDigest: `sha256:${'2'.repeat(64)}`,
    serializabilityProofDigest: `sha256:${'3'.repeat(64)}`,
    stewardId: 'steward-1',
    stewardRole: 'neutral-steward',
    memberTaskIds: ['TASK-A', 'TASK-B'],
    fileDigests: { [sharedPath]: blobDigest },
    canonicalWriteCount: 1,
    semanticAuthorization: {
      schemaId: 'atm.stewardSemanticValidationReceipt.v1',
      candidateDigest: `sha256:${'1'.repeat(64)}`,
      outputDigest: `sha256:${'2'.repeat(64)}`,
      decisionVerdict: 'pass',
      ok: true
    },
    semanticBaseHeadSha: headSha,
    semanticSealedSelectionSourceDigest: `sha256:${'4'.repeat(64)}`,
    semanticRunnerBuildDigest: `sha256:${'5'.repeat(64)}`,
    issuedAt: '2026-07-23T00:00:00.000Z',
    consumedAt: null,
    ...overrides
  } as SharedWriteProvenanceReceipt;
}

function observe(receipts: readonly unknown[], fileOverrides: Record<string, unknown> = {}) {
  return evaluateSharedWriteAdmission({
    canonicalRoot,
    baseSha,
    headSha,
    committingTaskId: 'TASK-A',
    files: [{ path: sharedPath, writeClaimTaskIds: ['TASK-A', 'TASK-B'], stagedBlobDigest: blobDigest, ...fileOverrides } as never],
    receipts
  });
}

// Cardinality is the only shared-write rule; nothing is special-cased.
assert.equal(isSharedCanonicalWrite({ path: sharedPath, writeClaimTaskIds: ['TASK-A'], stagedBlobDigest: blobDigest }), false);
assert.equal(isSharedCanonicalWrite({ path: sharedPath, writeClaimTaskIds: ['TASK-A', 'TASK-A'], stagedBlobDigest: blobDigest }), false);
assert.equal(isSharedCanonicalWrite({ path: sharedPath, writeClaimTaskIds: ['TASK-A', 'TASK-B'], stagedBlobDigest: blobDigest }), true);

// A private single-claim write is not admission-gated at all.
const privateOnly = evaluateSharedWriteAdmission({
  canonicalRoot,
  baseSha,
  headSha,
  files: [{ path: 'packages/core/src/private.ts', writeClaimTaskIds: ['TASK-A'], stagedBlobDigest: blobDigest }],
  receipts: []
});
assert.equal(privateOnly.ok, true);
assert.deepEqual(privateOnly.sharedFiles, []);

// Happy path: an exact receipt admits the shared write and carries attribution.
const admitted = observe([receipt()]);
assert.equal(admitted.ok, true, JSON.stringify(admitted.findings));
assert.deepEqual(admitted.admittedFiles, [sharedPath]);
assert.deepEqual(admitted.attributedTaskIds, ['TASK-A', 'TASK-B']);
assert.deepEqual(admitted.consumedReceiptIds, ['receipt-1']);

// Committing task owning one of the claims is not proof by itself.
const missing = observe([]);
assert.equal(missing.ok, false);
assert.equal(missing.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_REQUIRED);

const invalidCases: Array<[string, ReturnType<typeof observe>]> = [
  ['unknown schema', observe([{ ...receipt(), schemaId: 'atm.sharedWriteProvenanceReceipt.v99' }])],
  ['canonical write count', observe([receipt({ canonicalWriteCount: 2 })])],
  ['stale head', observe([receipt({ headSha: 'c'.repeat(40) })])],
  ['base drift', observe([receipt({ baseSha: 'd'.repeat(40) })])],
  ['root drift', observe([receipt({ canonicalRoot: '/other' })])],
  ['one changed byte', observe([receipt({ fileDigests: { [sharedPath]: 'git-blob:deadbeef' } })])],
  ['attribution', observe([receipt({ memberTaskIds: ['TASK-A'] })])],
  ['caller-shaped role', observe([receipt({ stewardRole: 'direct-brokered' as never })])],
  ['replayed receipt', observe([receipt({ consumedAt: '2026-07-23T01:00:00.000Z' })])],
  ['semantic missing', observe([receipt({ semanticAuthorization: undefined as never })])],
  ['semantic not passing', observe([receipt({
    semanticAuthorization: { schemaId: 'atm.stewardSemanticValidationReceipt.v1', candidateDigest: `sha256:${'1'.repeat(64)}`, outputDigest: `sha256:${'2'.repeat(64)}`, decisionVerdict: 'failed', ok: false }
  })])],
  ['semantic output drift', observe([receipt({ candidateOutputDigest: `sha256:${'9'.repeat(64)}` })])],
  ['semantic base head drift', observe([receipt({ semanticBaseHeadSha: 'e'.repeat(40) })])],
  ['missing runner build digest', observe([receipt({ semanticRunnerBuildDigest: '' })])]
];
for (const [label, decision] of invalidCases) {
  assert.equal(decision.ok, false, `${label} must fail closed`);
  assert.equal(decision.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_INVALID, `${label} must return the invalid code`);
}

// Unreadable staged bytes cannot be admitted either.
const unreadable = observe([receipt()], { stagedBlobDigest: null });
assert.equal(unreadable.ok, false);
assert.equal(unreadable.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_INVALID);

console.log('shared-write-provenance-policy.test passed');
