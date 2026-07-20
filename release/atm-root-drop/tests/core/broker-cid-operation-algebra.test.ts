import assert from 'node:assert/strict';
import { adjudicateSemanticRevalidation, canComposeOperations } from '../../packages/core/src/broker/semantic-adjudication/policy.ts';
import type { SemanticRevalidationRequest, SemanticWriteFact } from '../../packages/core/src/broker/semantic-contract.ts';

function write(operation: SemanticWriteFact['operation'], algebra: SemanticWriteFact['algebra'], anchorId = 'anchor-a'): SemanticWriteFact {
  return {
    atomId: 'atom-a',
    atomCid: 'cid-a',
    anchorId,
    filePath: 'src/a.ts',
    operation,
    algebra
  };
}

function request(writes: readonly SemanticWriteFact[]): SemanticRevalidationRequest {
  return {
    schemaId: 'atm.semanticRevalidationRequest.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'operation algebra fixture' },
    requestId: 'sem-op-001',
    taskId: 'ATM-GOV-0213',
    domain: 'code',
    publishIntent: true,
    digests: {
      baseDigest: 'sha256:base',
      currentDigest: 'sha256:current',
      publishedSetDigest: 'sha256:published'
    },
    readSet: [],
    publishedWriteSet: writes,
    assumptions: ['operation algebra is adapter declared'],
    validators: [{ command: 'npm run typecheck', available: true, result: 'pass' }]
  };
}

assert.equal(canComposeOperations(write('scalar', 'commutative'), write('scalar', 'commutative')), true);
assert.equal(canComposeOperations(write('rename', 'noncommutative'), write('modify', 'noncommutative')), false);
assert.equal(canComposeOperations(write('delete', 'noncommutative'), write('modify', 'noncommutative')), false);
assert.equal(canComposeOperations(write('modify', 'unknown'), write('modify', 'commutative')), false);
assert.equal(canComposeOperations(write('rename', 'noncommutative', 'anchor-a'), write('modify', 'noncommutative', 'anchor-b')), true);

const commutative = adjudicateSemanticRevalidation(request([write('scalar', 'commutative'), write('scalar', 'commutative')]));
assert.equal(commutative.verdict, 'valid');
assert.equal(commutative.ticketNextAction, 'publish');

const renameModify = adjudicateSemanticRevalidation(request([write('rename', 'noncommutative'), write('modify', 'noncommutative')]));
assert.equal(renameModify.verdict, 'steward-required');
assert.equal(renameModify.ticketNextAction, 'steward-review');
assert.ok(renameModify.operationConflicts.some((conflict) => conflict.startsWith('modify+rename')));

const deleteModify = adjudicateSemanticRevalidation(request([write('delete', 'noncommutative'), write('modify', 'noncommutative')]));
assert.equal(deleteModify.verdict, 'steward-required');
assert.ok(deleteModify.operationConflicts.some((conflict) => conflict.startsWith('delete+modify')));

console.log('broker CID operation algebra fixtures passed');
