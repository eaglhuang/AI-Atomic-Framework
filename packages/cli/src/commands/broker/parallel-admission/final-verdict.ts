import { createHash } from 'node:crypto';
import {
  applyParallelAdmissionSafetyDecision,
  defaultParallelAdmissionPolicy,
  evaluateParallelAdmissionSafety
} from '../../../../../core/src/broker/parallel-admission-policy.ts';
import type {
  ParallelAdmissionPolicy,
  ParallelAdmissionSafetyMetrics
} from '../../../../../core/src/broker/parallel-admission-policy.ts';
import type { ParallelReplayEvidence } from '../../../../../core/src/broker/replay/index.ts';

export interface Atm3FinalClosureInput {
  readonly actorId: string | null;
  readonly metrics: ParallelAdmissionSafetyMetrics;
  readonly inheritedAcceptanceOpenCount: number;
  readonly blockerBacklogIds: readonly string[];
  readonly readinessProbeFailures: readonly string[];
  readonly realMultiprocessReplay: boolean;
  readonly realTaskDogfoodIntersection: readonly string[];
  readonly realTaskDogfoodProven: boolean;
  readonly rollbackExercised: boolean;
  readonly sourceFrozenReleaseParity: boolean;
  readonly observedBreakerTripCount: number;
  readonly timeInQueueOnlyRatio: number;
  readonly now?: string;
}

export interface Atm3FinalClosureVerdict {
  readonly schemaId: 'atm.atm3FinalClosureVerdict.v1';
  readonly decision: 'close' | 'remain-open';
  readonly circuitBreakerAction: 'reset-with-digest' | 'trip-queue-only';
  readonly evidenceDigest: string;
  readonly blockers: readonly string[];
  readonly inheritedAcceptanceOpenCount: number;
  readonly blockerBacklogIds: readonly string[];
  readonly readinessProbeFailures: readonly string[];
  readonly policyAfterDecision: ParallelAdmissionPolicy;
}

export interface Atm3FinalClosureEvidenceInput {
  readonly actorId: string | null;
  readonly replayEvidence: ParallelReplayEvidence;
  readonly inheritedAcceptanceOpenCount: number;
  readonly blockerBacklogIds: readonly string[];
  readonly readinessProbeFailures: readonly string[];
  readonly realTaskDogfoodIntersection: readonly string[];
  readonly rollbackExercised: boolean;
  readonly sourceFrozenReleaseParity: boolean;
  readonly requiredCellCount?: number;
  readonly now?: string;
}

export function buildAtm3FinalClosureVerdictFromEvidence(input: Atm3FinalClosureEvidenceInput): Atm3FinalClosureVerdict {
  return buildAtm3FinalClosureVerdict({
    actorId: input.actorId,
    metrics: metricsFromReplayEvidence(input.replayEvidence, input.requiredCellCount ?? 420),
    inheritedAcceptanceOpenCount: input.inheritedAcceptanceOpenCount,
    blockerBacklogIds: input.blockerBacklogIds,
    readinessProbeFailures: input.readinessProbeFailures,
    realMultiprocessReplay: input.replayEvidence.workerCount >= 2
      && input.replayEvidence.maxConcurrentWorkers >= 2
      && input.replayEvidence.workerReceipts.every((worker) => worker.runner.entrypoint === 'atm.mjs')
      && input.replayEvidence.workerReceipts.every((worker) => (worker.commandReceipts?.length ?? 0) > 0),
    realTaskDogfoodIntersection: input.realTaskDogfoodIntersection,
    realTaskDogfoodProven: realTaskDogfoodProven(input.replayEvidence, input.realTaskDogfoodIntersection),
    rollbackExercised: input.rollbackExercised,
    sourceFrozenReleaseParity: input.sourceFrozenReleaseParity,
    observedBreakerTripCount: input.replayEvidence.faultCounters.unexpectedBreakerTripCount,
    timeInQueueOnlyRatio: input.replayEvidence.timeInQueueOnlyRatio,
    now: input.now
  });
}

export function buildAtm3FinalClosureVerdict(input: Atm3FinalClosureInput): Atm3FinalClosureVerdict {
  const safetyDecision = evaluateParallelAdmissionSafety(input.metrics);
  const blockers = [
    ...safetyDecision.blockers,
    ...finalClosureBlockers(input)
  ];
  const evidenceDigest = digestFinalClosureInput(input);
  const basePolicy = defaultParallelAdmissionPolicy();
  const policyAfterDecision = applyParallelAdmissionSafetyDecision(basePolicy, {
    actorId: input.actorId,
    metrics: input.metrics,
    now: input.now
  });

  if (blockers.length > 0) {
    return {
      schemaId: 'atm.atm3FinalClosureVerdict.v1',
      decision: 'remain-open',
      circuitBreakerAction: 'trip-queue-only',
      evidenceDigest,
      blockers,
      inheritedAcceptanceOpenCount: input.inheritedAcceptanceOpenCount,
      blockerBacklogIds: [...input.blockerBacklogIds],
      readinessProbeFailures: [...input.readinessProbeFailures],
      policyAfterDecision: {
        ...policyAfterDecision,
        tripped: true,
        fallbackMode: 'queue-only',
        tripReason: blockers.join('; ')
      }
    };
  }

  return {
    schemaId: 'atm.atm3FinalClosureVerdict.v1',
    decision: 'close',
    circuitBreakerAction: 'reset-with-digest',
    evidenceDigest,
    blockers,
    inheritedAcceptanceOpenCount: input.inheritedAcceptanceOpenCount,
    blockerBacklogIds: [],
    readinessProbeFailures: [],
    policyAfterDecision: {
      ...policyAfterDecision,
      tripped: false,
      resetEvidenceDigest: evidenceDigest,
      resetAt: input.now ?? policyAfterDecision.resetAt
    }
  };
}

function finalClosureBlockers(input: Atm3FinalClosureInput): string[] {
  const blockers: string[] = [];
  if (input.inheritedAcceptanceOpenCount !== 0) blockers.push(`inherited acceptance open count ${input.inheritedAcceptanceOpenCount}`);
  if (input.blockerBacklogIds.length > 0) blockers.push(`blocker backlog ids: ${input.blockerBacklogIds.join(', ')}`);
  if (input.readinessProbeFailures.length > 0) blockers.push(`readiness probe failures: ${input.readinessProbeFailures.join(', ')}`);
  if (!input.realMultiprocessReplay) blockers.push('real multiprocess replay evidence missing');
  if (input.realTaskDogfoodIntersection.length === 0) blockers.push('real-task dogfood declared intersection missing');
  if (!input.realTaskDogfoodProven) blockers.push('real-task dogfood lifecycle evidence missing');
  if (!input.rollbackExercised) blockers.push('rollback drill not exercised');
  if (!input.sourceFrozenReleaseParity) blockers.push('source/frozen/release parity missing');
  if (input.observedBreakerTripCount !== 0) blockers.push(`unexpected breaker trip count ${input.observedBreakerTripCount}`);
  if (input.timeInQueueOnlyRatio !== 0) blockers.push(`time in queue-only ratio ${input.timeInQueueOnlyRatio}`);
  return blockers;
}

function digestFinalClosureInput(input: Atm3FinalClosureInput): string {
  const stable = {
    metrics: input.metrics,
    inheritedAcceptanceOpenCount: input.inheritedAcceptanceOpenCount,
    blockerBacklogIds: [...input.blockerBacklogIds].sort(),
    readinessProbeFailures: [...input.readinessProbeFailures].sort(),
    realMultiprocessReplay: input.realMultiprocessReplay,
    realTaskDogfoodIntersection: [...input.realTaskDogfoodIntersection].sort(),
    realTaskDogfoodProven: input.realTaskDogfoodProven,
    rollbackExercised: input.rollbackExercised,
    sourceFrozenReleaseParity: input.sourceFrozenReleaseParity,
    observedBreakerTripCount: input.observedBreakerTripCount,
    timeInQueueOnlyRatio: input.timeInQueueOnlyRatio
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}

function realTaskDogfoodProven(evidence: ParallelReplayEvidence, requiredIntersection: readonly string[]): boolean {
  const dogfood = evidence.realTaskDogfood;
  if (!dogfood) return false;
  if (dogfood.taskCount < 2 || dogfood.actorCount < 2) return false;
  if (!dogfood.preservedIntersection || dogfood.terminalRefusalCount !== 0) return false;
  if (dogfood.manualWakeupCount !== 0 || dogfood.closurePacketPollutionCount !== 0) return false;
  if (!requiredIntersection.every((entry) => dogfood.declaredIntersection.includes(entry))) return false;
  return dogfood.traces.every((trace) =>
    trace.preservedIntersection
    && trace.successorWakeup
    && ['execute-now', 'queue-head', 'parallel-safe', 'not-required'].includes(trace.canonicalTicketState ?? '')
    && ['claim:registered-task', 'proposal:isolated', 'compose:shared-surface', 'close-packet:sealed']
      .every((step) => trace.lifecycle.includes(step))
  );
}

function metricsFromReplayEvidence(evidence: ParallelReplayEvidence, requiredCellCount: number): ParallelAdmissionSafetyMetrics {
  return {
    schemaId: 'atm.parallelAdmissionSafetyMetrics.v1',
    taskId: 'ATM-GOV-0235',
    cellCount: evidence.workerReceipts.reduce((count, worker) => count + (worker.commandReceipts?.length ?? 0), 0),
    requiredCellCount,
    medianMakespanImprovementPct: Math.max(0, Math.round((evidence.throughputGainRatio - 1) * 100)),
    activeThroughputImprovementPct: Math.max(0, Math.round((evidence.throughputGainRatio - 1) * 100)),
    productionCostRatio: evidence.costRatio,
    coveragePct: evidence.unavailableReceipts.length === 0 ? 100 : 0,
    sideEffectCounts: {
      silentOverwrite: evidence.faultCounters.silentOverwriteCount,
      escapedConflict: evidence.faultCounters.escapedConflictCount,
      duplicateSideEffect: evidence.faultCounters.duplicateSideEffectCount,
      unresolvedStarvation: evidence.faultCounters.unresolvedStarvationCount
    },
    taskSummary: {
      window: 'ATM-3.0 replay evidence',
      watermark: `${evidence.scenarioDigest}/${evidence.runnerDigest}`,
      sealedDigest: evidence.digest
    }
  };
}
