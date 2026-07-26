import assert from 'node:assert/strict';
import {
  evaluateValidationContract,
  type ValidationContractCatalog,
  type ValidationContractTask
} from '../../packages/core/src/evidence/validation-contract.ts';
import {
  createDeepModuleReviewReport,
  createDeepModuleReviewFingerprint
} from '../../packages/plugin-review-advisory/src/deep-module-provider.ts';
import { resolveRunnerRequiredValidationContract } from '../../scripts/run-validators/implementation.ts';
import { resolveBatchRequiredValidationContract } from '../../packages/cli/src/commands/batch/plan-executor.ts';

// TASK-SKL-0026 — causal validator selector.
//
// evaluateValidationContract() is the single pure evaluator that selects the
// smallest sound task-required case set from explicit references and causal
// impact edges. Every selection and omission carries a deterministic causal
// reason; high risk only deepens inside the proven impact cone; unknown
// boundaries request clarification instead of running the full repository; and
// a missing required contract fails closed rather than defaulting to a full run.

const catalog: ValidationContractCatalog = {
  cases: [
    {
      caseId: 'test_task_selector_behavior',
      command: 'node --strip-types tests/cli/causal-validator-selector.test.ts',
      coversAcceptance: ['ACC-1'],
      coversImpactEdges: ['validator-selection-seam'],
      pathTriggers: ['packages/core/src/evidence/validation-contract.ts']
    },
    {
      caseId: 'test_int_phase_suite_gate',
      command: 'node --strip-types tests/cli/phase-suite-promotion-gate.test.ts',
      coversImpactEdges: ['phase-suite-seam'],
      phase: 'release'
    },
    {
      caseId: 'test_task_cone_deep',
      command: 'node --strip-types tests/cli/cone-deep.test.ts',
      coversImpactEdges: ['validator-selection-seam']
    },
    {
      caseId: 'test_task_outside_cone',
      command: 'node --strip-types tests/cli/outside-cone.test.ts',
      coversImpactEdges: ['unrelated-seam']
    },
    {
      caseId: 'test_task_unref_cone',
      command: 'node --strip-types tests/cli/unref-cone.test.ts',
      coversImpactEdges: ['validator-selection-seam']
    },
    {
      caseId: 'test_task_unref_noncone',
      command: 'node --strip-types tests/cli/unref-noncone.test.ts',
      coversImpactEdges: ['unrelated-seam']
    }
  ]
};

const task: ValidationContractTask = {
  workItemId: 'TASK-SKL-0026',
  requiredTestCaseIds: ['test_task_selector_behavior'],
  phaseTestCaseIds: ['test_int_phase_suite_gate'],
  advisoryTestCaseIds: ['test_task_cone_deep', 'test_task_outside_cone'],
  testContributions: [
    {
      caseId: 'test_task_selector_behavior',
      coversAcceptance: ['ACC-1'],
      coversImpactEdges: ['validator-selection-seam'],
      responsibility: 'task-required'
    }
  ],
  causalGraph: { causalImpactEdges: ['validator-selection-seam', 'phase-suite-seam'] },
  acceptance: ['ACC-1 Select the smallest sound task-required set']
};

const evaluation = evaluateValidationContract(
  task,
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'], riskTier: 'low' },
  catalog,
  {
    gitHead: 'HEAD1',
    receipts: [
      { caseId: 'test_task_selector_behavior', status: 'passed', gitHead: 'HEAD1' }
    ]
  }
);

// --- required selection, manifests and causal reasons ----------------------
assert.deepEqual(evaluation.requiredCaseIds, ['test_task_selector_behavior']);
assert.equal(evaluation.failClosed, false);
assert.equal(evaluation.evaluatorId, 'atm.causal-validator-selector');
const requiredManifest = evaluation.executableManifests.find((entry) => entry.caseId === 'test_task_selector_behavior');
assert.ok(requiredManifest, 'required case must have an exact executable manifest');
assert.equal(requiredManifest?.responsibility, 'task-required');
assert.match(requiredManifest?.command ?? '', /causal-validator-selector\.test\.ts/);
const requiredReason = evaluation.causalReasons.find((entry) => entry.caseId === 'test_task_selector_behavior');
assert.match(requiredReason?.reason ?? '', /covers acceptance ACC-1/);
assert.match(requiredReason?.reason ?? '', /covers impact edges validator-selection-seam/);

// Every selection and omission has a deterministic causal reason.
for (const entry of [...evaluation.required, ...evaluation.phaseSuite, ...evaluation.advisory]) {
  assert.ok(entry.causalReason.length > 0, `selection ${entry.caseId} must carry a causal reason`);
}
for (const omission of evaluation.omissions) {
  assert.ok(omission.reason.length > 0, `omission ${omission.ref} must carry a causal reason`);
}

// Unreferenced catalog cases are omitted with cone-aware deterministic reasons.
const unrefCone = evaluation.omissions.find((entry) => entry.ref === 'test_task_unref_cone');
assert.equal(unrefCone?.reason, 'within the impact cone but not referenced by the task-required contract');
const unrefNonCone = evaluation.omissions.find((entry) => entry.ref === 'test_task_unref_noncone');
assert.equal(unrefNonCone?.reason, 'no causal relationship to the declared impact edges or required contract');

// Phase owners and freshness inputs are observable without executing anything.
assert.deepEqual(evaluation.phaseCaseIds, ['test_int_phase_suite_gate']);
assert.deepEqual(evaluation.phaseOwners, [{ phase: 'release', caseIds: ['test_int_phase_suite_gate'] }]);
const selectorFreshness = evaluation.freshnessInputs.find((entry) => entry.caseId === 'test_task_selector_behavior');
assert.equal(selectorFreshness?.status, 'fresh');
const phaseFreshness = evaluation.freshnessInputs.find((entry) => entry.caseId === 'test_int_phase_suite_gate');
assert.equal(phaseFreshness?.status, 'missing');

// Metrics are observable (selection ratio etc.).
assert.equal(evaluation.metrics.catalogCaseCount, 6);
assert.equal(evaluation.metrics.requiredCount, 1);
assert.ok(evaluation.metrics.selectionRatio > 0 && evaluation.metrics.selectionRatio < 1);
assert.equal(evaluation.metrics.impactConeEdgeCount, 2);

// --- high risk deepens only inside the proven impact cone ------------------
const highRisk = evaluateValidationContract(
  task,
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'], riskTier: 'high' },
  catalog
);
assert.ok(highRisk.requiredCaseIds.includes('test_task_cone_deep'), 'high risk must deepen inside the cone');
assert.ok(!highRisk.requiredCaseIds.includes('test_task_outside_cone'), 'high risk must not pull in cases outside the cone');
const outsideOmission = highRisk.omissions.find((entry) => entry.ref === 'test_task_outside_cone' && /outside the proven impact cone/.test(entry.reason));
assert.ok(outsideOmission, 'a case outside the cone must be omitted with a deterministic reason');

// --- fail closed: no full-repository default -------------------------------
const failClosed = evaluateValidationContract(
  { workItemId: 'TASK-SKL-0026', requiredTestCaseIds: [] },
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'] },
  catalog
);
assert.equal(failClosed.failClosed, true);
assert.deepEqual(failClosed.requiredCaseIds, []);
assert.ok(
  failClosed.unknownBoundaryDiagnostics.some((entry) => entry.code === 'ATM_VALIDATION_CONTRACT_MISSING_REQUIRED_SET'),
  'missing required contract must fail closed with a diagnostic, not a full run'
);

// A broad suite declared task-required without a dependency edge fails closed.
const broadRequired = evaluateValidationContract(
  {
    workItemId: 'TASK-SKL-0026',
    requiredTestCaseIds: ['npm run typecheck'],
    testContributions: [{ caseId: 'npm run typecheck', responsibility: 'task-required' }]
  },
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'] },
  { cases: [{ caseId: 'npm run typecheck', command: 'npm run typecheck', broadSuite: true }] }
);
assert.equal(broadRequired.failClosed, true);
assert.ok(
  broadRequired.unknownBoundaryDiagnostics.some((entry) => entry.code === 'ATM_VALIDATION_CONTRACT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE'),
  'a task-required broad suite without a declared edge must be diagnosed and fail closed'
);

// --- unknown boundaries request clarification ------------------------------
const unknownBoundary = evaluateValidationContract(
  { workItemId: 'TASK-SKL-0026', requiredTestCaseIds: [] },
  { changedFiles: ['docs/uncharted-surface.md'] },
  { cases: [{ caseId: 'test_task_selector_behavior', command: 'node x', pathTriggers: ['packages/**'] }] }
);
assert.ok(
  unknownBoundary.unknownBoundaryDiagnostics.some((entry) =>
    entry.code === 'ATM_VALIDATION_CONTRACT_UNKNOWN_BOUNDARY' && entry.needsClarification
  ),
  'unknown boundaries must request scope/impact clarification'
);
assert.ok(unknownBoundary.metrics.unknownBoundaryCount >= 1);

// --- deletion test: runner and batch adapters delegate to the one evaluator -
// The runner and batch adapters must not recompute their own required set; they
// delegate to evaluateValidationContract and fail closed without a contract.
const runnerEvaluation = resolveRunnerRequiredValidationContract(
  task,
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'], riskTier: 'low' },
  catalog,
  { gitHead: 'HEAD1', receipts: [{ caseId: 'test_task_selector_behavior', status: 'passed', gitHead: 'HEAD1' }] }
);
assert.deepEqual(runnerEvaluation.requiredCaseIds, evaluation.requiredCaseIds);
assert.equal(runnerEvaluation.schemaId, evaluation.schemaId);

const batchEvaluation = resolveBatchRequiredValidationContract(
  task,
  { changedFiles: ['packages/core/src/evidence/validation-contract.ts'], riskTier: 'low' },
  catalog
);
assert.deepEqual(batchEvaluation.requiredCaseIds, evaluation.requiredCaseIds);

for (const adapter of [resolveRunnerRequiredValidationContract, resolveBatchRequiredValidationContract]) {
  const failed = adapter({ requiredTestCaseIds: [] }, { changedFiles: ['x.ts'] }, catalog, {});
  assert.equal(failed.failClosed, true, 'adapters must fail closed without a required contract');
  assert.deepEqual(failed.requiredCaseIds, [], 'adapters must not default to a full-repository run');
}

// --- sealed atm-deep-module-refactor review for the extracted module -------
// Acceptance: seal the evaluateValidationContract interface, adapter inventory,
// deletion test and the deep-module-review baseline. The receipt is provider-
// neutral and reproducible from this pinned canonical input.
const reviewInput = {
  taskId: 'TASK-SKL-0026',
  candidate: {
    moduleId: 'atm.causal-validator-selector',
    sourcePaths: [
      'packages/cli/src/commands/test-catalog.ts',
      'packages/core/src/evidence/phase-suite.ts'
    ],
    ownerAtomOrMap: 'atm.validator-runtime',
    publicInterface: 'evaluateValidationContract(task, changeSet, catalog, evidence)',
    rollback: 'revert-commit-and-select-legacy-all-run-profile',
    causalValidators: [
      'node --strip-types tests/cli/causal-validator-selector.test.ts',
      'node --strip-types tests/cli/phase-suite-promotion-gate.test.ts'
    ]
  },
  observedFriction: {
    triggers: ['duplicated-policy', 'caller-complexity', 'missing-test-seam', 'file-length'] as const,
    evidenceRefs: ['TASK-SKL-0026.preflight']
  },
  dependencyClasses: ['in-process', 'local-substitutable'] as const,
  proposedAdapters: ['runner-required-set-adapter', 'batch-required-set-adapter']
};
const review = createDeepModuleReviewReport(reviewInput);
assert.equal(review.status, 'pass', 'two adapters + actionable triggers must pass the deep-module review');
assert.equal(review.seam.requiresTwoAdapters, true);
assert.ok(review.seam.proposedAdapters.length >= 2, 'adapter inventory must list at least two adapters');
assert.match(review.seam.deletionTest, /deleted/, 'the review must record a deletion test');
assert.match(review.seam.proposedInterface, /evaluateValidationContract/);
assert.match(review.receiptFingerprint, /^deep-module-review:[a-f0-9]{8}$/);
// The sealed baseline is reproducible: recomputing the fingerprint from the
// report (minus the fingerprint field) yields the identical value.
const { receiptFingerprint, ...reportBody } = review;
assert.equal(createDeepModuleReviewFingerprint(reportBody), receiptFingerprint, 'sealed review fingerprint must be reproducible');
assert.equal(createDeepModuleReviewReport(reviewInput).receiptFingerprint, receiptFingerprint, 'sealed review must be deterministic');

console.log(JSON.stringify({
  marker: '[causal-validator-selector:test] ok',
  requiredCaseIds: evaluation.requiredCaseIds,
  phaseCaseIds: evaluation.phaseCaseIds,
  failClosedCovered: true,
  deepModuleReviewBaseline: receiptFingerprint
}));
