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

export interface Atm3FinalClosureInput {
  readonly actorId: string | null;
  readonly metrics: ParallelAdmissionSafetyMetrics;
  readonly inheritedAcceptanceOpenCount: number;
  readonly blockerBacklogIds: readonly string[];
  readonly readinessProbeFailures: readonly string[];
  readonly realMultiprocessReplay: boolean;
  readonly realTaskDogfoodIntersection: readonly string[];
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
    rollbackExercised: input.rollbackExercised,
    sourceFrozenReleaseParity: input.sourceFrozenReleaseParity,
    observedBreakerTripCount: input.observedBreakerTripCount,
    timeInQueueOnlyRatio: input.timeInQueueOnlyRatio
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}
