import assert from 'node:assert/strict';
import {
  bindRedGreenLifecycle,
  evaluateTddPhaseReceipt,
  evaluateTddSuccessRate,
  evaluateTaskTddLifecycle,
  parseTddMode,
  TDD_MODES
} from '../../packages/core/src/evidence/tdd-cycle.ts';
import {
  parseTddCardFields,
  validateTddCardImport
} from '../../packages/cli/src/commands/tasks/task-import-validators.ts';
import { parseEvidenceTddRunOptions } from '../../packages/cli/src/commands/evidence/verbs/run.ts';

assert.deepEqual([...TDD_MODES], ['required', 'recommended', 'reasoned-not-applicable']);
assert.equal(parseTddMode('required'), 'required');
assert.equal(parseTddMode('recommended'), 'recommended');
assert.equal(parseTddMode('reasoned-not-applicable'), 'reasoned-not-applicable');
assert.equal(parseTddMode('not_applicable'), 'reasoned-not-applicable');
assert.equal(parseTddMode('bogus'), null);

const baseline = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const candidate = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const bindingBase = {
  caseId: 'test_int_runner_sync_actor_continuity_8f3a2c1d',
  testDigest: 'sha256:digest-actor-continuity',
  acceptanceIds: ['ACC-2'],
  publicSeam: 'identity-to-runner-sync',
  baselineSha: baseline,
  candidateSha: null as string | null
};

const validRed = evaluateTddPhaseReceipt({
  phase: 'red',
  binding: bindingBase,
  exitCode: 1,
  commandOk: false,
  failureClass: 'assertion-failure',
  failureReason: 'actor mismatch is detected',
  executedCaseCount: 1,
  assertionCount: 2
});
assert.equal(validRed.valid, true);
assert.equal(validRed.countsAsRed, true);

for (const failureClass of ['syntax', 'setup', 'environment', 'unrelated'] as const) {
  const invalid = evaluateTddPhaseReceipt({
    phase: 'red',
    binding: bindingBase,
    exitCode: 1,
    commandOk: false,
    failureClass,
    failureReason: failureClass,
    executedCaseCount: 1,
    assertionCount: 1
  });
  assert.equal(invalid.valid, false, `${failureClass} must not count as red`);
  assert.ok(invalid.reasons.some((reason) => reason.includes(failureClass)));
}

const validGreen = evaluateTddPhaseReceipt({
  phase: 'green',
  binding: { ...bindingBase, candidateSha: candidate },
  exitCode: 0,
  commandOk: true,
  executedCaseCount: 1,
  assertionCount: 2
});
assert.equal(validGreen.valid, true);
assert.equal(validGreen.countsAsGreen, true);

const bound = bindRedGreenLifecycle({
  red: {
    phase: 'red',
    binding: bindingBase,
    exitCode: 1,
    commandOk: false,
    failureClass: 'assertion-failure',
    executedCaseCount: 1,
    assertionCount: 2
  },
  green: {
    phase: 'green',
    binding: { ...bindingBase, candidateSha: candidate },
    exitCode: 0,
    commandOk: true,
    executedCaseCount: 1,
    assertionCount: 2
  }
});
assert.equal(bound.ok, true);
assert.equal(bound.caseId, bindingBase.caseId);
assert.equal(bound.testDigest, bindingBase.testDigest);
assert.equal(bound.publicSeam, bindingBase.publicSeam);
assert.equal(bound.baselineSha, baseline);
assert.equal(bound.candidateSha, candidate);

const mismatched = bindRedGreenLifecycle({
  red: {
    phase: 'red',
    binding: bindingBase,
    exitCode: 1,
    commandOk: false,
    failureClass: 'assertion-failure',
    executedCaseCount: 1,
    assertionCount: 1
  },
  green: {
    phase: 'green',
    binding: {
      ...bindingBase,
      caseId: 'test_int_other_case_11111111',
      candidateSha: candidate
    },
    exitCode: 0,
    commandOk: true,
    executedCaseCount: 1,
    assertionCount: 1
  }
});
assert.equal(mismatched.ok, false);
assert.ok(mismatched.reasons.includes('case-id-mismatch'));

const secondCaseBinding = {
  caseId: 'test_int_runner_sync_seal_freshness_1b2c3d4e',
  testDigest: 'sha256:digest-seal-freshness',
  acceptanceIds: ['ACC-3'],
  publicSeam: 'identity-to-runner-sync',
  baselineSha: baseline,
  candidateSha: null as string | null
};

const multi = evaluateTaskTddLifecycle({
  tddMode: 'required',
  pairs: [
    {
      red: {
        phase: 'red',
        binding: bindingBase,
        exitCode: 1,
        commandOk: false,
        failureClass: 'assertion-failure',
        executedCaseCount: 1,
        assertionCount: 1
      },
      green: {
        phase: 'green',
        binding: { ...bindingBase, candidateSha: candidate },
        exitCode: 0,
        commandOk: true,
        executedCaseCount: 1,
        assertionCount: 1
      }
    },
    {
      red: {
        phase: 'red',
        binding: secondCaseBinding,
        exitCode: 1,
        commandOk: false,
        failureClass: 'assertion-failure',
        executedCaseCount: 1,
        assertionCount: 1
      },
      green: {
        phase: 'green',
        binding: { ...secondCaseBinding, candidateSha: candidate },
        exitCode: 0,
        commandOk: true,
        executedCaseCount: 1,
        assertionCount: 1
      }
    }
  ]
});
assert.equal(multi.ok, true);
assert.equal(multi.bindings.length, 2);
assert.equal(multi.successRate.eligibleCount, 2);
assert.equal(multi.successRate.successCount, 2);
assert.equal(multi.successRate.rate, 1);

const rate = evaluateTddSuccessRate([
  { caseId: 'a', lifecycleComplete: true },
  {
    caseId: 'b',
    lifecycleComplete: true,
    exemption: {
      caseId: 'b',
      kind: 'mechanical',
      reason: 'generated binder only',
      reviewed: true,
      reviewActorId: 'reviewer-1'
    }
  },
  {
    caseId: 'c',
    lifecycleComplete: true,
    exemption: {
      caseId: 'c',
      kind: 'docs',
      reason: 'docs-only rewrite',
      reviewed: true,
      reviewActorId: 'reviewer-1'
    }
  },
  { caseId: 'd', lifecycleComplete: true, advisory: true },
  { caseId: 'e', lifecycleComplete: false, quarantineStatus: 'quarantined' },
  { caseId: 'f', lifecycleComplete: false }
]);
assert.equal(rate.eligibleCount, 2);
assert.equal(rate.successCount, 1);
assert.equal(rate.excludedCount, 4);
assert.equal(rate.rate, 0.5);
assert.deepEqual([...rate.excludedCaseIds].sort(), ['b', 'c', 'd', 'e']);

const na = evaluateTaskTddLifecycle({
  tddMode: 'reasoned-not-applicable',
  notApplicableReason: 'docs-only authoring template update',
  pairs: []
});
assert.equal(na.ok, true);
assert.equal(na.bindings.length, 0);

const naMissing = evaluateTaskTddLifecycle({
  tddMode: 'reasoned-not-applicable',
  pairs: []
});
assert.equal(naMissing.ok, false);
assert.ok(naMissing.reasons.includes('reasoned-not-applicable-requires-reason'));

const parsed = parseTddCardFields({
  frontmatter: {
    tddMode: 'required',
    tddExemptions: [{
      caseId: 'test_task_docs_only_aaaaaaaa',
      kind: 'docs',
      reason: 'readme typo',
      reviewed: true,
      reviewActorId: 'captain'
    }]
  }
});
assert.equal(parsed.tddMode, 'required');
assert.equal(parsed.tddExemptions.length, 1);

const invalidMode = validateTddCardImport({ frontmatter: { tddMode: 'optional' } });
assert.ok(invalidMode.errors.some((entry) => entry.includes('tddMode')));

const unreviewed = validateTddCardImport({
  frontmatter: {
    tddMode: 'recommended',
    tddExemptions: [{
      caseId: 'test_task_mech_bbbbbbbb',
      kind: 'mechanical',
      reason: 'scaffold',
      reviewed: false
    }]
  }
});
assert.ok(unreviewed.errors.some((entry) => entry.includes('must be reviewed')));

const naImport = validateTddCardImport({
  frontmatter: { tddMode: 'reasoned-not-applicable' }
});
assert.ok(naImport.errors.some((entry) => entry.includes('tddNotApplicableReason')));

const tddOpts = parseEvidenceTddRunOptions([
  '--task', 'TASK-SKL-0025',
  '--command', 'node -e "process.exit(1)"',
  '--tdd-phase', 'red',
  '--tdd-case-id', bindingBase.caseId,
  '--tdd-test-digest', bindingBase.testDigest,
  '--tdd-acceptance', 'ACC-2',
  '--tdd-public-seam', bindingBase.publicSeam,
  '--tdd-baseline-sha', baseline,
  '--tdd-failure-class', 'assertion-failure'
]);
assert.ok(tddOpts);
assert.equal(tddOpts?.phase, 'red');
assert.equal(tddOpts?.caseId, bindingBase.caseId);
assert.equal(tddOpts?.acceptanceIds[0], 'ACC-2');

console.log('[tdd-case-id-red-green-lifecycle:test] ok');
