import type { ParallelAdmissionPolicy, ParallelAdmissionSafetyMetrics } from '../../../../../core/src/broker/parallel-admission-policy.ts';
import type { ParallelReplayEvidence } from '../../../../../core/src/broker/replay/index.ts';
import type { ClosureObservation } from './closure-observation.ts';
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
export interface Atm3FinalClosureObservationInput {
    readonly actorId: string | null;
    readonly metrics: ParallelAdmissionSafetyMetrics;
    readonly observation: ClosureObservation;
    readonly realMultiprocessReplay: boolean;
    readonly realTaskDogfoodIntersection: readonly string[];
    readonly realTaskDogfoodProven: boolean;
    readonly now?: string;
}
export declare function buildAtm3FinalClosureVerdictFromObservation(input: Atm3FinalClosureObservationInput): Atm3FinalClosureVerdict;
export declare function buildAtm3FinalClosureVerdictFromEvidence(input: Atm3FinalClosureEvidenceInput): Atm3FinalClosureVerdict;
export declare function buildAtm3FinalClosureVerdict(input: Atm3FinalClosureInput): Atm3FinalClosureVerdict;
