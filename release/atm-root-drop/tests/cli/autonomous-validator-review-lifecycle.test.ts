import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateValidationContract,
  type ValidationContractCatalog,
  type ValidationContractTask
} from '../../packages/core/src/evidence/validation-contract.ts';
import {
  createDeepModuleReviewReport,
  createDeepModuleReviewFingerprint
} from '../../packages/plugin-review-advisory/src/deep-module-provider.ts';
import {
  resolveEvidenceRunValidationContract,
  planSelectedCaseExecution
} from '../../packages/cli/src/commands/evidence/verbs/run.ts';
import {
  resolveAutoEvidenceValidationContract,
  mapAutoEvidenceSelectedCases
} from '../../packages/cli/src/commands/taskflow/auto-evidence-mapper.ts';
import {
  resolveClosePreflightValidationContract,
  validationContractDigest,
  evaluateValidatorReviewLifecycleGate
} from '../../packages/cli/src/commands/taskflow/close-preflight.ts';
import { resolveWriteReadinessValidationContract } from '../../packages/cli/src/commands/taskflow/write-readiness.ts';
import {
  resolveReviewAdvisoryValidationContract,
  invalidateReceiptsForCandidateChange
} from '../../packages/cli/src/commands/review-advisory.ts';
import { validateCausalValidatorContractImport } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';
import { buildContractImportRecoveryManifest } from '../../packages/cli/src/commands/tasks/contract-import-recovery.ts';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';

// TASK-SKL-0029 — autonomous validator and review lifecycle integration.
//
// Authoring readiness, test contributions, TDD receipts, Standards/Spec review,
// causal execution, phase ownership and pre-close freshness are one autonomous
// lifecycle built on TASK-SKL-0026's validation contract. Every lifecycle
// adapter — evidence run, auto-evidence, pre-close, write-readiness and the
// advisory review — delegates required-case selection and freshness to the one
// evaluateValidationContract evaluator instead of deriving its own set, and the
// same validation-contract digest threads through every stage.

const catalog: ValidationContractCatalog = {
  cases: [
    {
      caseId: 'test_task_lifecycle_behavior',
      command: 'node --strip-types tests/cli/autonomous-validator-review-lifecycle.test.ts',
      coversAcceptance: ['ACC-1'],
      coversImpactEdges: ['validator-review-lifecycle-seam'],
      pathTriggers: ['packages/cli/src/commands/taskflow/close-preflight.ts']
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
      coversImpactEdges: ['validator-review-lifecycle-seam']
    }
  ]
};

const task: ValidationContractTask = {
  workItemId: 'TASK-SKL-0029',
  requiredTestCaseIds: ['test_task_lifecycle_behavior'],
  phaseTestCaseIds: ['test_int_phase_suite_gate'],
  advisoryTestCaseIds: ['test_task_cone_deep'],
  testContributions: [
    {
      caseId: 'test_task_lifecycle_behavior',
      coversAcceptance: ['ACC-1'],
      coversImpactEdges: ['validator-review-lifecycle-seam'],
      responsibility: 'task-required'
    }
  ],
  causalGraph: { causalImpactEdges: ['validator-review-lifecycle-seam', 'phase-suite-seam'] },
  acceptance: ['ACC-1 Integrate the autonomous validator/review lifecycle']
};

const changeSet = {
  changedFiles: ['packages/cli/src/commands/taskflow/close-preflight.ts'],
  riskTier: 'low' as const
};
const freshEvidence = {
  gitHead: 'HEAD1',
  receipts: [{ caseId: 'test_task_lifecycle_behavior', status: 'passed' as const, gitHead: 'HEAD1' }]
};

const canonical = evaluateValidationContract(task, changeSet, catalog, freshEvidence);
assert.deepEqual(canonical.requiredCaseIds, ['test_task_lifecycle_behavior']);
assert.equal(canonical.failClosed, false);
assert.equal(canonical.evaluatorId, 'atm.causal-validator-selector');

// --- deletion test: every lifecycle adapter delegates to the one evaluator ---
// Each adapter must reproduce the canonical selection exactly and must fail
// closed (empty required set) without a task-required contract — no adapter may
// silently upgrade a task to a full-repository suite.
const adapters = [
  resolveEvidenceRunValidationContract,
  resolveAutoEvidenceValidationContract,
  resolveClosePreflightValidationContract,
  resolveWriteReadinessValidationContract,
  resolveReviewAdvisoryValidationContract
];
for (const adapter of adapters) {
  const evaluation = adapter(task, changeSet, catalog, freshEvidence);
  assert.deepEqual(evaluation.requiredCaseIds, canonical.requiredCaseIds, 'adapter must reproduce the canonical required set');
  assert.equal(evaluation.schemaId, canonical.schemaId);
  assert.equal(validationContractDigest(evaluation), validationContractDigest(canonical), 'adapters must thread the same contract digest');

  const failed = adapter({ workItemId: 'TASK-SKL-0029', requiredTestCaseIds: [] }, { changedFiles: ['x.ts'] }, catalog, {});
  assert.equal(failed.failClosed, true, 'adapters must fail closed without a required contract');
  assert.deepEqual(failed.requiredCaseIds, [], 'adapters must not default to a full-repository run');
}

// --- same validation-contract digest is deterministic across stages ----------
assert.match(validationContractDigest(canonical), /^validation-contract:[a-f0-9]{16}$/);
assert.equal(
  validationContractDigest(canonical),
  validationContractDigest(evaluateValidationContract(task, changeSet, catalog, freshEvidence)),
  'the contract digest must be reproducible from the same evaluation'
);

// --- fail-closed pre-close gate ----------------------------------------------
// (a) Clean fresh required receipt with executed cases -> gate passes.
const cleanGate = evaluateValidatorReviewLifecycleGate({
  evaluation: canonical,
  requiredReceipts: [{ caseId: 'test_task_lifecycle_behavior', status: 'passed', executedCaseCount: 3 }]
});
assert.equal(cleanGate.ok, true, 'a fresh, executed required set must pass pre-close');
assert.equal(cleanGate.contractDigest, validationContractDigest(canonical));

// (b) Missing required contract -> fail closed, never a full run.
const missingContract = evaluateValidationContract({ workItemId: 'TASK-SKL-0029', requiredTestCaseIds: [] }, changeSet, catalog);
const missingGate = evaluateValidatorReviewLifecycleGate({ evaluation: missingContract });
assert.equal(missingGate.ok, false);
assert.ok(missingGate.blockers.some((b) => b.code === 'ATM_VALIDATION_CONTRACT_MISSING_REQUIRED_SET'));

// (c) Unresolved required case (no fresh receipt) -> blocked.
const unresolvedEval = evaluateValidationContract(task, changeSet, catalog);
const unresolvedGate = evaluateValidatorReviewLifecycleGate({ evaluation: unresolvedEval });
assert.equal(unresolvedGate.ok, false);
assert.ok(unresolvedGate.blockers.some((b) => b.code === 'ATM_CLOSE_PRECHECK_REQUIRED_CASE_UNRESOLVED'));

// (d) Zero-test: a required case that passed but executed nothing -> blocked.
const zeroTestGate = evaluateValidatorReviewLifecycleGate({
  evaluation: canonical,
  requiredReceipts: [{ caseId: 'test_task_lifecycle_behavior', status: 'passed', executedCaseCount: 0 }]
});
assert.equal(zeroTestGate.ok, false);
assert.ok(zeroTestGate.blockers.some((b) => b.code === 'ATM_CLOSE_PRECHECK_ZERO_TEST_RESULT'));

// (e) Stale phase ownership via the single phase-suite evaluator -> blocked.
const stalePhaseGate = evaluateValidatorReviewLifecycleGate({
  evaluation: canonical,
  requiredReceipts: [{ caseId: 'test_task_lifecycle_behavior', status: 'passed', executedCaseCount: 3 }],
  phaseSuite: {
    checkpoint: 'release',
    requiredPhaseCaseIds: ['test_int_phase_suite_gate'],
    gitHead: 'HEADNEW',
    receipts: [{ caseId: 'test_int_phase_suite_gate', status: 'passed', gitHead: 'HEADOLD' }]
  }
});
assert.equal(stalePhaseGate.ok, false);
assert.ok(stalePhaseGate.blockers.some((b) => b.code === 'ATM_CLOSE_PRECHECK_STALE_PHASE_OWNERSHIP'));

// (f) Advisory selections never block: a passing gate stays ok even though the
// catalog carries an advisory case.
assert.ok(canonical.advisoryCaseIds.includes('test_task_cone_deep'));
assert.equal(cleanGate.blockers.length, 0, 'advisory cases must not add pre-close blockers');

// --- candidate-change invalidation -------------------------------------------
// A source change invalidates every TDD/review/required-case receipt whose
// recorded candidate digest no longer matches the current candidate.
const invalidations = invalidateReceiptsForCandidateChange({
  candidateDigest: 'sha256:NEWCANDIDATE',
  receipts: [
    { kind: 'tdd', caseId: 'test_task_lifecycle_behavior', candidateDigest: 'sha256:OLD' },
    { kind: 'review', caseId: 'test_task_lifecycle_behavior', candidateDigest: 'sha256:NEWCANDIDATE' },
    { kind: 'required-case', caseId: 'test_task_lifecycle_behavior', candidateDigest: 'sha256:STALE' }
  ]
});
assert.deepEqual(
  invalidations.map((entry) => entry.kind).sort(),
  ['required-case', 'tdd'],
  'only receipts whose candidate digest changed are invalidated'
);
assert.ok(invalidations.every((entry) => entry.reason === 'candidate-digest-changed'));

// --- selected-case structured execution --------------------------------------
const plan = planSelectedCaseExecution(canonical);
assert.equal(plan.failClosed, false);
assert.ok(plan.steps.some((step) => step.caseId === 'test_task_lifecycle_behavior' && step.responsibility === 'task-required'));
assert.match(plan.steps[0]?.command ?? '', /autonomous-validator-review-lifecycle\.test\.ts/);
const failClosedPlan = planSelectedCaseExecution(missingContract);
assert.equal(failClosedPlan.failClosed, true);
assert.deepEqual(failClosedPlan.steps, [], 'a missing contract must not schedule any case');

const autoMappings = mapAutoEvidenceSelectedCases(canonical, { scripts: {} });
assert.ok(autoMappings.some((entry) => entry.caseId === 'test_task_lifecycle_behavior'));
assert.deepEqual(mapAutoEvidenceSelectedCases(missingContract, { scripts: {} }), [], 'auto-evidence must map nothing when the contract is missing');

// --- import: precise missing contract/case/group recovery --------------------
// A card that declares acceptance/impact edges but no resolvable required cases
// must expose the exact missing fields and fail closed with one executable
// recovery manifest.
const incompleteImport = validateCausalValidatorContractImport({
  frontmatter: {
    // Declares an advisory case (so the card opts into the causal contract) but
    // leaves the required set and contributions empty while asserting acceptance
    // and impact edges — the contract is present yet unresolvable.
    advisoryTestCaseIds: ['test_task_cone_deep'],
    causalGraph: { causalImpactEdges: ['validator-review-lifecycle-seam'] }
  },
  acceptance: ['ACC-1 lifecycle'],
  causalImpactEdges: ['validator-review-lifecycle-seam']
});
const recovery = buildContractImportRecoveryManifest({
  validation: incompleteImport,
  taskId: 'TASK-SKL-0029',
  planPath: 'skl-tool-first-upgrade/tasks/TASK-SKL-0029.task.md'
});
assert.equal(recovery.failClosed, true, 'a card missing resolvable required cases must fail closed on import');
assert.ok(recovery.missing.length > 0, 'the recovery manifest must list the exact missing fields');
assert.match(recovery.recoveryCommand ?? '', /tasks import --from .* --dry-run --json/, 'recovery must be one executable command');

// The recovery manifest must not just be a pure helper — the real import
// orchestration must fail closed and surface the executable recovery in its
// structured CliError.details when a single card opts into the validation
// contract but leaves its required set unresolvable.
const tempRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-lifecycle-import-recovery-'));
const brokenCard = path.join(tempRepo, 'TASK-SKL-9029.task.md');
writeFileSync(brokenCard, [
  '---',
  'task_id: TASK-SKL-9029',
  'title: Validation contract opts in but stays unresolvable',
  'status: planned',
  'scopePaths:',
  '  - src/example.ts',
  'deliverables:',
  '  - src/example.ts',
  'requiredTestCaseIds:',
  '  - test_task_unresolved_deadbeef',
  'testContributions:',
  '  - caseId: test_task_unresolved_deadbeef',
  '    coversAcceptance:',
  '      - ACC-NOPE',
  '    responsibility: task-required',
  'causalGraph:',
  '  causalImpactEdges:',
  '    - lifecycle-uncovered-edge',
  '---',
  '',
  '# TASK-SKL-9029',
  '',
  '## Acceptance',
  '',
  '- ACC-1 The required case must resolve before import.'
].join('\n'), 'utf8');

let orchestrationRejected = false;
try {
  await runTasksImport(['--cwd', tempRepo, '--from', brokenCard, '--dry-run', '--json']);
} catch (error: any) {
  orchestrationRejected = true;
  const details = error?.details ?? error?.data ?? {};
  assert.equal(error?.code, 'ATM_TASKS_PLAN_PARSE_FAILED', JSON.stringify(details, null, 2));
  assert.ok(details.contractRecovery, 'real import failure must carry the contract recovery manifest');
  assert.equal(details.contractRecovery.failClosed, true, 'orchestration must fail closed on an unresolvable contract');
  assert.ok(
    Array.isArray(details.contractRecovery.missing) && details.contractRecovery.missing.length > 0,
    'orchestration recovery must list the exact missing fields'
  );
  assert.match(
    details.contractRecovery.recoveryCommand ?? '',
    /tasks import --from .* --dry-run --json/,
    'orchestration recovery must be one executable command, not a full-repository run'
  );
}
assert.equal(orchestrationRejected, true, 'import orchestration must reject an unresolvable validation contract');

// --- sealed atm-deep-module-refactor review for the lifecycle module ----------
// Acceptance: seal the evaluateValidationContract/evaluatePhaseSuitePromotion
// interface, the five-adapter inventory, the deletion test and the deep-module
// review baseline. The receipt is provider-neutral and reproducible.
const reviewInput = {
  taskId: 'TASK-SKL-0029',
  candidate: {
    moduleId: 'atm.validator-review-lifecycle-gate',
    sourcePaths: [
      'packages/cli/src/commands/evidence/verbs/run.ts',
      'packages/cli/src/commands/taskflow/auto-evidence-mapper.ts',
      'packages/cli/src/commands/taskflow/close-preflight.ts',
      'packages/cli/src/commands/taskflow/write-readiness.ts',
      'packages/cli/src/commands/review-advisory.ts'
    ],
    ownerAtomOrMap: 'atm.taskflow',
    publicInterface: 'evaluateValidationContract(task, changeSet, catalog, evidence) + evaluatePhaseSuitePromotion(input)',
    rollback: 'revert-commit-and-disable-vnext-lifecycle-feature-flag',
    causalValidators: [
      'node --strip-types tests/cli/autonomous-validator-review-lifecycle.test.ts',
      'npm run validate:skill-templates',
      'npm run typecheck'
    ]
  },
  observedFriction: {
    triggers: ['duplicated-policy', 'shotgun-changes', 'missing-test-seam'] as const,
    evidenceRefs: ['TASK-SKL-0029.preflight']
  },
  dependencyClasses: ['in-process'] as const,
  proposedAdapters: [
    'evidence-run-lifecycle-adapter',
    'auto-evidence-lifecycle-adapter',
    'close-preflight-lifecycle-gate',
    'write-readiness-lifecycle-adapter',
    'review-advisory-lifecycle-adapter'
  ]
};
const review = createDeepModuleReviewReport(reviewInput);
assert.equal(review.status, 'pass', 'five adapters + actionable triggers must pass the deep-module review');
assert.equal(review.seam.requiresTwoAdapters, true);
assert.ok(review.seam.proposedAdapters.length >= 2);
assert.match(review.seam.proposedInterface, /evaluateValidationContract/);
assert.match(review.receiptFingerprint, /^deep-module-review:[a-f0-9]{8}$/);
const { receiptFingerprint, ...reportBody } = review;
assert.equal(createDeepModuleReviewFingerprint(reportBody), receiptFingerprint, 'sealed review fingerprint must be reproducible');
assert.equal(createDeepModuleReviewReport(reviewInput).receiptFingerprint, receiptFingerprint, 'sealed review must be deterministic');

console.log(JSON.stringify({
  marker: '[autonomous-validator-review-lifecycle:test] ok',
  requiredCaseIds: canonical.requiredCaseIds,
  phaseCaseIds: canonical.phaseCaseIds,
  contractDigest: validationContractDigest(canonical),
  deepModuleReviewBaseline: receiptFingerprint
}));
