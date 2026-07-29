import assert from 'node:assert/strict';
import {
  materializePatchCandidate
} from '../../packages/core/src/broker/patch-candidate-materializer.ts';
import {
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED,
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE,
  buildPostComposeSemanticCandidateFromMaterialization,
  evaluatePostComposeSemanticValidation,
  toStewardSemanticAuthorizationReceipt,
  type SemanticValidatorReceipt
} from '../../packages/core/src/broker/post-compose-semantic-validation-policy.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

function mutation(
  overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'target' | 'value'>
): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: overrides.actorId ?? 'worker-a',
    taskId: overrides.taskId ?? 'TASK-DEMO',
    filePath: 'registry.json',
    op: 'upsert',
    ...overrides
  };
}

function commandBacked(
  validatorId: string,
  outcome: 'pass' | 'fail',
  exitCode: number
): SemanticValidatorReceipt {
  return {
    validatorId,
    outcome,
    commandBacked: true,
    executable: 'node',
    argv: ['--strip-types', `tests/${validatorId}.ts`],
    cwd: '.',
    exitCode,
    stdoutDigest: `sha256:${'c'.repeat(64)}`,
    stderrDigest: `sha256:${'d'.repeat(64)}`
  };
}

const materialization = materializePatchCandidate({
  baseHeadSha: 'head-1',
  baseFiles: [{ filePath: 'registry.json', content: '{\n  "records": {}\n}\n' }],
  requests: [
    mutation({ requestId: 'req-a', target: '/records/a', value: { ok: true } }),
    mutation({ requestId: 'req-b', target: '/records/b', value: { ok: true } })
  ],
  cardValidators: ['semantic.gate'],
  adapterStaticChecks: [],
  catalogTargetedTests: []
});
assert.equal(materialization.ok, true);

const passCandidate = buildPostComposeSemanticCandidateFromMaterialization(materialization, [
  commandBacked('semantic.gate', 'pass', 0)
]);
const pass = evaluatePostComposeSemanticValidation(passCandidate);
assert.equal(pass.verdict, 'pass');
assert.equal(pass.canonicalWriteAuthorized, true);
assert.ok(pass.reasons.includes('serializability-insufficient-alone'));
const passAuth = toStewardSemanticAuthorizationReceipt({
  candidateDigest: materialization.candidateDigest,
  decision: pass
});
assert.equal(passAuth.ok, true);

// Negative control: disjoint serializable patches, combined candidate fails sealed validator.
const failCandidate = buildPostComposeSemanticCandidateFromMaterialization(materialization, [
  commandBacked('semantic.gate', 'fail', 1)
], { canonicalWriteAttempted: true });
const fail = evaluatePostComposeSemanticValidation(failCandidate);
assert.equal(fail.verdict, 'failed');
assert.equal(fail.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED);
assert.equal(fail.canonicalWriteAuthorized, false);
assert.ok(fail.reasons.includes('canonical-write-prohibited-after-semantic-gate'));
assert.equal(
  toStewardSemanticAuthorizationReceipt({
    candidateDigest: materialization.candidateDigest,
    decision: fail
  }).ok,
  false
);

const unavailable = evaluatePostComposeSemanticValidation(
  buildPostComposeSemanticCandidateFromMaterialization(materialization, [
    {
      validatorId: 'semantic.gate',
      outcome: 'unavailable',
      commandBacked: false
    }
  ])
);
assert.equal(unavailable.verdict, 'unavailable');
assert.equal(unavailable.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE);
assert.equal(unavailable.canonicalWriteAuthorized, false);

// Post-reveal union drift invalidates the cell.
const drifted = evaluatePostComposeSemanticValidation({
  ...passCandidate,
  observedSelection: {
    ...materialization.sealedSelection,
    cardValidators: [...materialization.sealedSelection.cardValidators, 'late.added'],
    requiredValidatorIds: [...materialization.sealedSelection.requiredValidatorIds, 'late.added']
  }
});
assert.equal(drifted.verdict, 'unavailable');
assert.ok(drifted.reasons.includes('post-reveal-validator-union-drift'));

// Serializability present with missing receipts never authorizes write.
const serialOnly = evaluatePostComposeSemanticValidation(
  buildPostComposeSemanticCandidateFromMaterialization(materialization, [])
);
assert.equal(serialOnly.canonicalWriteAuthorized, false);
assert.equal(serialOnly.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE);

console.log('post-compose-semantic-validation-policy.test passed');
