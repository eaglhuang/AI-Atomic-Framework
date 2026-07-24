import assert from 'node:assert/strict';
import { createDeepModuleReviewReport } from '../../packages/plugin-review-advisory/src/deep-module-provider.ts';

const deepModuleReview = createDeepModuleReviewReport({
  taskId: 'ATM-GOV-0264',
  candidate: {
    moduleId: 'atm.broker.admission-facade',
    sourcePaths: [
      'packages/core/src/broker/conflict-matrix.ts',
      'packages/core/src/broker/decision.ts',
      'packages/core/src/broker/decision/proposal-overlap.ts',
      'packages/cli/src/commands/next/claim-parallel-preflight.ts',
      'packages/cli/src/commands/next/claim-admission.ts',
      'packages/cli/src/commands/next/claim-conflict-log.ts'
    ],
    ownerAtomOrMap: 'atm.broker.admission',
    publicInterface: 'evaluateBrokerAdmission(request, registry, policy): BrokerAdmissionResult',
    rollback: 'Restore queue-only handling for ambiguous same-atom cases while retaining the generic replay and canonical result contract.',
    causalValidators: [
      'test_task_atm_gov_0264_same_atom_proposal_admission_5dcd8b13',
      'test_int_plan3_same_atom_bounded_compose_0d1f4a72'
    ]
  },
  observedFriction: {
    triggers: [
      'repeated-bugs',
      'shotgun-changes',
      'duplicated-policy',
      'caller-complexity',
      'private-internal-tests',
      'missing-test-seam'
    ],
    evidenceRefs: [
      'ATM-GOV-0263-and-TASK-SKL-0022-same-atom-empty-shared-path-replay',
      'packages/core/src/broker/decision.ts',
      'packages/core/src/broker/decision/proposal-overlap.ts',
      'packages/cli/src/commands/next/claim-parallel-preflight.ts',
      'packages/cli/src/commands/next/claim-admission.ts',
      'packages/cli/src/commands/next/claim-conflict-log.ts'
    ]
  },
  dependencyClasses: ['in-process', 'local-substitutable'],
  proposedAdapters: ['core-broker-decision-adapter', 'cli-next-claim-adapter']
});

assert.equal(deepModuleReview.schemaId, 'atm.deepModuleReviewReport.v1');
assert.equal(deepModuleReview.providerContract, 'atm.deepModuleRefactorProvider.v1');
assert.equal(deepModuleReview.status, 'pass');
assert.equal(deepModuleReview.confidence, 'high');
assert.equal(
  deepModuleReview.seam.proposedInterface,
  'evaluateBrokerAdmission(request, registry, policy): BrokerAdmissionResult'
);
assert.deepEqual(deepModuleReview.seam.proposedAdapters, [
  'core-broker-decision-adapter',
  'cli-next-claim-adapter'
]);
assert.equal(deepModuleReview.hiddenComplexity.depth, 'high');
assert.match(deepModuleReview.seam.deletionTest, /too shallow/);
assert.match(deepModuleReview.seam.interfaceTest, /interface only/);
assert.match(deepModuleReview.rollback, /queue-only/);
assert.deepEqual(deepModuleReview.causalValidators, [
  'test_task_atm_gov_0264_same_atom_proposal_admission_5dcd8b13',
  'test_int_plan3_same_atom_bounded_compose_0d1f4a72'
]);

console.log(JSON.stringify({
  schemaId: deepModuleReview.schemaId,
  providerContract: deepModuleReview.providerContract,
  providerId: deepModuleReview.providerId,
  providerVersion: deepModuleReview.providerVersion,
  taskId: deepModuleReview.taskId,
  status: deepModuleReview.status,
  confidence: deepModuleReview.confidence,
  moduleId: deepModuleReview.candidate.moduleId,
  ownerAtomOrMap: deepModuleReview.candidate.ownerAtomOrMap,
  interface: deepModuleReview.seam.proposedInterface,
  adapters: deepModuleReview.seam.proposedAdapters,
  hiddenComplexity: deepModuleReview.hiddenComplexity,
  rollback: deepModuleReview.rollback,
  causalValidators: deepModuleReview.causalValidators,
  receiptFingerprint: deepModuleReview.receiptFingerprint
}));
