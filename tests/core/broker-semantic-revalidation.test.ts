import assert from 'node:assert/strict';
import { adjudicateSemanticRevalidation } from '../../packages/core/src/broker/semantic-adjudication/policy.ts';
import type { SemanticRevalidationRequest, SemanticWriteFact } from '../../packages/core/src/broker/semantic-contract.ts';

const digests = {
  baseDigest: 'sha256:base',
  currentDigest: 'sha256:current',
  publishedSetDigest: 'sha256:published'
};

function request(overrides: Partial<SemanticRevalidationRequest> = {}): SemanticRevalidationRequest {
  return {
    schemaId: 'atm.semanticRevalidationRequest.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'semantic revalidation fixture' },
    requestId: 'sem-001',
    taskId: 'ATM-GOV-0213',
    domain: 'code',
    publishIntent: true,
    digests,
    readSet: [{
      atomId: 'atom-helper',
      atomCid: 'cid-helper',
      anchorId: 'anchor-helper',
      filePath: 'packages/core/src/helper.ts',
      digest: 'sha256:read',
      provenance: ['content-anchor@0.1.0'],
      confidence: 'high'
    }],
    publishedWriteSet: [],
    assumptions: ['helper returns stable ids'],
    validators: [{ command: 'npm run typecheck', available: true, result: 'pass' }],
    ...overrides
  };
}

const staleWrite: SemanticWriteFact = {
  atomId: 'atom-helper',
  atomCid: 'cid-helper',
  anchorId: 'anchor-helper',
  filePath: 'packages/core/src/helper.ts',
  operation: 'modify',
  algebra: 'noncommutative',
  postconditions: ['helper returns normalized ids']
};

const stale = adjudicateSemanticRevalidation(request({ publishedWriteSet: [staleWrite] }));
assert.equal(stale.verdict, 'recompute-required');
assert.equal(stale.ticketNextAction, 'recompute');
assert.deepEqual(stale.digests, digests);
assert.deepEqual(stale.assumptions, ['helper returns stable ids']);
assert.equal(stale.validatorRefs[0]?.command, 'npm run typecheck');
assert.deepEqual(stale.staleReadAnchors, ['anchor-helper']);

const unavailable = adjudicateSemanticRevalidation(request({
  validators: [{ command: 'npm run semantic:oracle', available: false }]
}));
assert.equal(unavailable.verdict, 'inconclusive');
assert.equal(unavailable.ticketNextAction, 'steward-review');

for (const domain of ['docs', 'planning', 'private'] as const) {
  const readOnly = adjudicateSemanticRevalidation(request({
    domain,
    publishIntent: false,
    publishedWriteSet: [staleWrite],
    validators: [{ command: 'npm run semantic:oracle', available: false }]
  }));
  assert.equal(readOnly.verdict, 'valid', `${domain} reads should not be queued`);
  assert.equal(readOnly.ticketNextAction, 'keep-read-lane');
}

console.log('broker semantic revalidation fixtures passed');
