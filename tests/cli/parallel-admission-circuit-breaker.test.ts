import assert from 'node:assert/strict';
import { buildAtm3FinalClosureVerdict } from '../../packages/cli/src/commands/broker/parallel-admission/final-verdict.ts';

const failingMetrics = {
  schemaId: 'atm.parallelAdmissionSafetyMetrics.v1' as const,
  taskId: 'ATM-GOV-0235',
  cellCount: 419,
  requiredCellCount: 420,
  medianMakespanImprovementPct: 24,
  activeThroughputImprovementPct: 20,
  productionCostRatio: 1.12,
  coveragePct: 99,
  sideEffectCounts: {
    silentOverwrite: 0,
    escapedConflict: 1,
    duplicateSideEffect: 0,
    unresolvedStarvation: 0
  },
  taskSummary: {
    window: 'ATM-3.0 final replay',
    watermark: 'ATM-GOV-0234/ATM-GOV-0235',
    sealedDigest: `sha256:${'c'.repeat(64)}`
  }
};

const verdict = buildAtm3FinalClosureVerdict({
  actorId: 'tester',
  metrics: failingMetrics,
  inheritedAcceptanceOpenCount: 1,
  blockerBacklogIds: ['ATM-BUG-2026-07-21-222'],
  readinessProbeFailures: ['planning mirror residue'],
  realMultiprocessReplay: false,
  realTaskDogfoodIntersection: [],
  rollbackExercised: false,
  sourceFrozenReleaseParity: false,
  observedBreakerTripCount: 1,
  timeInQueueOnlyRatio: 0.25,
  now: '2026-07-21T00:00:00.000Z'
});

assert.equal(verdict.decision, 'remain-open');
assert.equal(verdict.circuitBreakerAction, 'trip-queue-only');
assert.equal(verdict.policyAfterDecision.tripped, true);
assert.equal(verdict.policyAfterDecision.fallbackMode, 'queue-only');
assert.ok(verdict.blockers.includes('escaped conflict detected'));
assert.ok(verdict.blockers.includes('real multiprocess replay evidence missing'));
assert.ok(verdict.blockers.some((blocker) => blocker.includes('ATM-BUG-2026-07-21-222')));

console.log('parallel admission circuit breaker verdict ok');
