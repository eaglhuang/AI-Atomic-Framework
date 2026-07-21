import assert from 'node:assert/strict';
import { buildAtm3FinalClosureVerdict } from '../../packages/cli/src/commands/broker/parallel-admission/final-verdict.ts';

const passingMetrics = {
  schemaId: 'atm.parallelAdmissionSafetyMetrics.v1' as const,
  taskId: 'ATM-GOV-0235',
  cellCount: 420,
  requiredCellCount: 420,
  medianMakespanImprovementPct: 31,
  activeThroughputImprovementPct: 34,
  productionCostRatio: 1.02,
  coveragePct: 100,
  sideEffectCounts: {
    silentOverwrite: 0,
    escapedConflict: 0,
    duplicateSideEffect: 0,
    unresolvedStarvation: 0
  },
  taskSummary: {
    window: 'ATM-3.0 final replay',
    watermark: 'ATM-GOV-0234/ATM-GOV-0235',
    sealedDigest: `sha256:${'b'.repeat(64)}`
  }
};

const verdict = buildAtm3FinalClosureVerdict({
  actorId: 'tester',
  metrics: passingMetrics,
  inheritedAcceptanceOpenCount: 0,
  blockerBacklogIds: [],
  readinessProbeFailures: [],
  realMultiprocessReplay: true,
  realTaskDogfoodIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  rollbackExercised: true,
  sourceFrozenReleaseParity: true,
  observedBreakerTripCount: 0,
  timeInQueueOnlyRatio: 0,
  now: '2026-07-21T00:00:00.000Z'
});

assert.equal(verdict.schemaId, 'atm.atm3FinalClosureVerdict.v1');
assert.equal(verdict.decision, 'close');
assert.equal(verdict.circuitBreakerAction, 'reset-with-digest');
assert.equal(verdict.blockers.length, 0);
assert.match(verdict.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
assert.equal(verdict.policyAfterDecision.tripped, false);
assert.equal(verdict.policyAfterDecision.resetEvidenceDigest, verdict.evidenceDigest);

console.log('atm 3 final closure verdict ok');
