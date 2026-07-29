import assert from 'node:assert/strict';
import {
  evaluatePhaseSuitePromotion,
  type PhaseSuiteReceipt
} from '../../packages/core/src/evidence/phase-suite.ts';

// TASK-SKL-0026 — phase-suite scheduler / promotion gate.
//
// evaluatePhaseSuitePromotion() blocks promotion/release when a required
// phase-suite receipt is missing, stale or failed, and exposes observable
// metrics (cache, fan-out, queue wait, selection ratio, duration, false blocks
// and defect-detection tier). It never runs commands or mutates evidence.

const now = '2026-07-25T12:00:00.000Z';
const gitHead = 'HEADREL';

function receipt(overrides: Partial<PhaseSuiteReceipt> & { caseId: string }): PhaseSuiteReceipt {
  return {
    status: 'passed',
    gitHead,
    observedAt: '2026-07-25T11:00:00.000Z',
    durationMs: 1200,
    cacheDecision: 'cache-miss',
    fanOutConsumerCount: 1,
    queueWaitMs: 50,
    ...overrides
  };
}

// --- clean pass: all required receipts present, fresh and passing ----------
const clean = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: ['test_int_phase_a', 'test_int_phase_b'],
  gitHead,
  now,
  catalogPhaseCaseCount: 4,
  receipts: [
    receipt({ caseId: 'test_int_phase_a' }),
    receipt({ caseId: 'test_int_phase_b', cacheDecision: 'cache-hit' })
  ]
});
assert.equal(clean.ok, true);
assert.equal(clean.blocked, false);
assert.equal(clean.promotionAllowed, true);
assert.deepEqual(clean.satisfiedCaseIds, ['test_int_phase_a', 'test_int_phase_b']);
assert.equal(clean.metrics.defectDetectionTier, 'clean');
assert.equal(clean.metrics.cacheHitCount, 1);
assert.equal(clean.metrics.fanOutConsumerCount, 2);
assert.equal(clean.metrics.durationMs, 2400);
assert.equal(clean.metrics.selectionRatio, 0.5);
assert.equal(clean.metrics.falseBlockCount, 0);

// --- missing receipt blocks promotion --------------------------------------
const missing = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: ['test_int_phase_a', 'test_int_phase_b'],
  gitHead,
  now,
  receipts: [receipt({ caseId: 'test_int_phase_a' })]
});
assert.equal(missing.ok, false);
assert.equal(missing.promotionAllowed, false);
assert.ok(missing.blockers.some((entry) => entry.caseId === 'test_int_phase_b' && entry.reason === 'missing'));
assert.equal(missing.metrics.defectDetectionTier, 'stale-guard');

// --- failed receipt blocks promotion ---------------------------------------
const failed = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: ['test_int_phase_a'],
  gitHead,
  now,
  receipts: [receipt({ caseId: 'test_int_phase_a', status: 'failed' })]
});
assert.equal(failed.ok, false);
assert.ok(failed.blockers.some((entry) => entry.reason === 'failed'));
assert.equal(failed.metrics.defectDetectionTier, 'blocking');

// --- stale receipt (git head mismatch) blocks promotion --------------------
const staleHead = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: ['test_int_phase_a'],
  gitHead,
  now,
  receipts: [receipt({ caseId: 'test_int_phase_a', gitHead: 'OLDHEAD' })]
});
assert.equal(staleHead.ok, false);
assert.ok(staleHead.blockers.some((entry) => entry.reason === 'stale'));

// --- stale receipt (freshness window elapsed) blocks promotion -------------
const staleTime = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: ['test_int_phase_a'],
  gitHead,
  now,
  freshnessWindowMs: 60 * 60 * 1000,
  receipts: [receipt({ caseId: 'test_int_phase_a', observedAt: '2026-07-24T00:00:00.000Z' })]
});
assert.equal(staleTime.ok, false);
assert.ok(staleTime.blockers.some((entry) => entry.reason === 'stale'));

// --- empty required contract does not silently allow a release -------------
const emptyContract = evaluatePhaseSuitePromotion({
  checkpoint: 'release',
  requiredPhaseCaseIds: [],
  gitHead,
  now,
  receipts: []
});
assert.equal(emptyContract.promotionAllowed, false, 'an empty phase-suite contract must not allow a release');

console.log(JSON.stringify({
  marker: '[phase-suite-promotion-gate:test] ok',
  cleanPromotion: clean.promotionAllowed,
  blockerReasonsCovered: ['missing', 'failed', 'stale'],
  defectDetectionTier: failed.metrics.defectDetectionTier
}));
