import assert from 'node:assert/strict';
import { buildClosureObservation, summarizeClosebackDisposition } from '../../packages/cli/src/commands/broker/parallel-admission/closure-observation.ts';
import {
  buildAtm3FinalClosureVerdict,
  buildAtm3FinalClosureVerdictFromObservation
} from '../../packages/cli/src/commands/broker/parallel-admission/final-verdict.ts';

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
  realTaskDogfoodProven: false,
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

const disposition = summarizeClosebackDisposition([
  { id: 'ATM-BUG-213', disposition: 'absorbed-by-existing-card', status: 'Open', ownerCard: 'ATM-GOV-0262' },
  { id: 'ATM-BUG-214', disposition: 'external-owner', status: 'Open', ownerCard: 'TASK-ERR-0003' },
  { id: 'ATM-BUG-222', disposition: 'terminal', status: 'Fixed in recovery repair' },
  { id: 'ATM-BUG-237', disposition: 'deferred-with-reason', status: 'Needs task card', rationale: 'dispatch audit remains non-blocking' },
  { id: 'ATM-BUG-999', disposition: 'inserted', status: 'Open' }
]);
assert.equal(disposition.absorbedByExistingCard, 1);
assert.equal(disposition.externalOwner, 1);
assert.equal(disposition.deferredWithReason, 1);
assert.equal(disposition.terminal, 1);
assert.deepEqual(disposition.openBlockerIds, ['ATM-BUG-999']);

const observation = buildClosureObservation({
  backlogItems: [
    { id: 'ATM-BUG-213', disposition: 'absorbed-by-existing-card', status: 'Open', ownerCard: 'ATM-GOV-0262' },
    { id: 'ATM-BUG-222', disposition: 'terminal', status: 'Fixed in recovery repair' }
  ],
  sourceObservationDigest: `sha256:${'a'.repeat(64)}`,
  frozenObservationDigest: `sha256:${'a'.repeat(64)}`,
  packageDistObservationDigest: `sha256:${'a'.repeat(64)}`,
  releaseProjectionObservationDigest: `sha256:${'a'.repeat(64)}`,
  rollbackDrill: {
    exercised: true,
    restoredPriorSafeState: true,
    usedDirectRuntimeJsonEdit: false,
    retryCount: 1
  },
  healthyReplay: {
    unexpectedTripCount: 0,
    queueOnlyResidencyCount: 0
  },
  injectedFailureReplay: {
    trippedQueueOnly: true,
    resetRequiresNewerPassingDigest: true
  }
});

const observationVerdict = buildAtm3FinalClosureVerdictFromObservation({
  actorId: 'tester',
  metrics: {
    ...failingMetrics,
    cellCount: 420,
    requiredCellCount: 420,
    medianMakespanImprovementPct: 30,
    activeThroughputImprovementPct: 30,
    productionCostRatio: 1,
    coveragePct: 100,
    sideEffectCounts: {
      silentOverwrite: 0,
      escapedConflict: 0,
      duplicateSideEffect: 0,
      unresolvedStarvation: 0
    }
  },
  observation,
  realMultiprocessReplay: true,
  realTaskDogfoodIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  realTaskDogfoodProven: true,
  now: '2026-07-29T00:00:00.000Z'
});
assert.equal(observationVerdict.decision, 'close');
assert.equal(observationVerdict.circuitBreakerAction, 'reset-with-digest');

console.log('parallel admission circuit breaker verdict ok');
