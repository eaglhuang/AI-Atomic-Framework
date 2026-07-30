import assert from 'node:assert/strict';
import { evaluateDiagnosticLoopReceipt } from '../../packages/core/src/evidence/diagnostic-loop.ts';

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

const validReceipt = evaluateDiagnosticLoopReceipt({
  taskId: 'TASK-SKL-0033',
  symptom: 'claim writes reserve event before planning seal failure',
  severity: 'blocking',
  reproducer: {
    command: 'node atm.mjs next --claim --task TASK-BLOCKED --json',
    exitCode: 1,
    stdoutSha256: sha('1'),
    stderrSha256: sha('2')
  },
  symptomObserved: true,
  reproductionRate: 1,
  minimizedFixture: 'tests/fixtures/claim-seal-drift',
  candidateDigest: sha('3'),
  environmentDigest: sha('4'),
  hypotheses: [
    {
      id: 'h1',
      summary: 'seal gate runs after lifecycle mutation',
      predictedObservation: 'ledger contains reserve/promote even when claim fails',
      experimentCommand: 'node --strip-types tests/cli/claim-atomicity.test.ts',
      experimentResult: 'matched'
    }
  ],
  winningHypothesisId: 'h1',
  regressionCaseId: 'test_claim_atomicity_no_mutation_before_seal',
  greenEvidence: {
    command: 'node --strip-types tests/cli/claim-atomicity.test.ts',
    exitCode: 0,
    stdoutSha256: sha('5'),
    stderrSha256: sha('6')
  },
  temporaryInstrumentation: 'removed',
  createdAt: '2026-07-30T00:00:00.000Z'
});

assert.equal(validReceipt.valid, true);
assert.equal(validReceipt.admission, 'admit-repair');
assert.equal(validReceipt.reasons.length, 0);
assert.equal(validReceipt.receiptDigest.startsWith('sha256:'), true);

const noSymptom = evaluateDiagnosticLoopReceipt({
  ...validReceipt,
  symptomObserved: false,
  reproducer: { ...validReceipt.reproducer, exitCode: 0 }
});

assert.equal(noSymptom.valid, false);
assert.equal(noSymptom.admission, 'fail-closed');
assert(noSymptom.reasons.includes('symptom-not-observed'));
assert(noSymptom.reasons.includes('reproducer-must-fail-or-signal-symptom'));

const modelOnlyHypothesis = evaluateDiagnosticLoopReceipt({
  ...validReceipt,
  hypotheses: [
    {
      id: 'h1',
      summary: 'model thinks this is stale state',
      predictedObservation: '',
      experimentCommand: '',
      experimentResult: 'inconclusive'
    }
  ]
});

assert.equal(modelOnlyHypothesis.valid, false);
assert(modelOnlyHypothesis.reasons.includes('winning-hypothesis-must-match-experiment'));
assert(modelOnlyHypothesis.reasons.includes('hypothesis-missing-prediction:h1'));
assert(modelOnlyHypothesis.reasons.includes('hypothesis-missing-experiment:h1'));
