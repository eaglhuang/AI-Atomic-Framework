import { type TelemetryObservationBase, type TelemetrySourceAvailability } from '../observation.ts';
export type BrokerParallelAdmissionMode = 'parallel-first' | 'policy-pre-serialize' | 'surface-cannot-parallel';
export type BrokerDecisionDisposition = 'execute-now' | 'batch' | 'queue' | 'hard-reject';
export type BrokerCompositionDecision = 'not-candidate' | 'candidate-selected' | 'candidate-skipped';
export type BrokerCorrectness = 'correct' | 'false-positive' | 'false-negative' | 'escaped' | 'manual-overridden' | 'pending';
export type BrokerRulingClass = 'none' | 'R1-same-task-owner' | 'R2-semantic-dependency' | 'R3-main-commit-core' | 'R4-docs-exception';
export type BrokerSideEffectAllowance = 'allowed' | 'blocked' | 'deferred';
export interface BrokerDecisionTraceInput {
    readonly decisionId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly runId?: string;
    readonly waveId?: string | null;
    readonly observedAt?: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
    readonly durationMs?: number;
    readonly eligibleOpportunity: boolean;
    readonly parallelAdmissionMode: BrokerParallelAdmissionMode;
    readonly admissionReason: string;
    readonly conflictAxes?: readonly string[];
    readonly requestedFiles?: readonly string[];
    readonly conflictSet?: readonly string[];
    readonly structuredOverlap?: {
        readonly kind: string;
        readonly confidence: number;
    };
    readonly anchorResolutionRate?: number;
    readonly disposition: BrokerDecisionDisposition;
    readonly compositionDecision?: BrokerCompositionDecision;
    readonly fallbackReason?: string | null;
    readonly sideEffectAllowance: BrokerSideEffectAllowance;
    readonly waitedMs?: number;
    readonly latencyMs?: number;
    readonly queue?: {
        readonly depth?: number;
        readonly position?: number;
        readonly agingMs?: number;
        readonly bypassCount?: number;
        readonly wakeupKey?: string | null;
    };
    readonly compose?: {
        readonly candidateCount?: number;
        readonly selectedCount?: number;
        readonly skippedCount?: number;
        readonly compositionCostMs?: number;
        readonly savedSerializationDepth?: number;
        readonly serializabilityVerdict?: 'pass' | 'fail' | 'unknown';
        readonly partialCompose?: boolean;
    };
    readonly readWriteSet?: {
        readonly readSetDigest?: string | null;
        readonly writeSetDigest?: string | null;
        readonly intersectionKind?: string | null;
        readonly revalidationResult?: 'pass' | 'fail' | 'pending' | 'not-required';
    };
    readonly rulingClass?: BrokerRulingClass;
    readonly configDigest?: string;
}
export interface BrokerDecisionObservation {
    readonly schemaId: 'atm.brokerDecisionObservation.v1';
    readonly specVersion: '0.1.0';
    readonly decisionId: string;
    readonly observedAt: string;
    readonly eligibleOpportunity: boolean;
    readonly parallelAdmissionMode: BrokerParallelAdmissionMode;
    readonly admissionReason: string;
    readonly conflictAxes: readonly string[];
    readonly redactedConflictDigest: string;
    readonly requestedFileCount: number;
    readonly conflictSetCount: number;
    readonly structuredOverlap: {
        readonly kind: string;
        readonly confidence: number;
    };
    readonly anchorResolutionRate: number;
    readonly disposition: BrokerDecisionDisposition;
    readonly compositionDecision: BrokerCompositionDecision;
    readonly fallbackReason: string | null;
    readonly sideEffectAllowance: BrokerSideEffectAllowance;
    readonly waitedMs: number | null;
    readonly latencyMs: number | null;
    readonly queue: Required<NonNullable<BrokerDecisionTraceInput['queue']>>;
    readonly compose: Required<NonNullable<BrokerDecisionTraceInput['compose']>>;
    readonly readWriteSet: Required<NonNullable<BrokerDecisionTraceInput['readWriteSet']>>;
    readonly rulingClass: BrokerRulingClass;
    readonly observation: TelemetryObservationBase;
    readonly sourceAvailability: TelemetrySourceAvailability;
    readonly warnings: readonly string[];
}
export interface BrokerOutcomeTraceInput {
    readonly outcomeRef: string;
    readonly decisionId: string;
    readonly observedAt?: string;
    readonly commitSha?: string | null;
    readonly fileSlices?: readonly string[];
    readonly validatorRefs?: readonly string[];
    readonly rollbackRef?: string | null;
    readonly downstreamIncidentRefs?: readonly string[];
    readonly manualReviewRef?: string | null;
    readonly semanticResult?: 'pass' | 'fail' | 'unknown' | 'not-run';
    readonly serialOracle?: 'compatible' | 'incompatible' | 'unknown';
    readonly sideEffectActual?: 'applied' | 'blocked' | 'deferred' | 'not-attempted';
}
export interface BrokerOutcomeClassification {
    readonly schemaId: 'atm.brokerOutcomeClassification.v1';
    readonly specVersion: '0.1.0';
    readonly outcomeRef: string;
    readonly decisionId: string;
    readonly classifiedAt: string;
    readonly correctness: BrokerCorrectness;
    readonly reason: string;
    readonly ageMs: number;
    readonly pendingEscalation: {
        readonly escalated: boolean;
        readonly ownerReviewRef: string | null;
        readonly backlogExit: string | null;
    };
    readonly join: {
        readonly commitSha: string | null;
        readonly fileSliceDigest: string;
        readonly validatorDigest: string;
        readonly rollbackRef: string | null;
        readonly downstreamIncidentDigest: string;
        readonly semanticResult: BrokerOutcomeTraceInput['semanticResult'];
        readonly serialOracle: BrokerOutcomeTraceInput['serialOracle'];
        readonly sideEffectActual: BrokerOutcomeTraceInput['sideEffectActual'];
    };
}
export interface BrokerDecisionTelemetrySummary {
    readonly schemaId: 'atm.brokerDecisionTelemetrySummary.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly generatedAt: string;
    readonly window: {
        readonly start: string | null;
        readonly end: string | null;
    };
    readonly decisionCount: number;
    readonly eligibleOpportunities: number;
    readonly parallelAdmission: Record<BrokerParallelAdmissionMode, number>;
    readonly dispositions: Record<BrokerDecisionDisposition, number>;
    readonly composition: {
        readonly candidate: number;
        readonly selected: number;
        readonly skipped: number;
        readonly savedSerializationDepth: number;
        readonly compositionCostMsP95: number | null;
    };
    readonly queue: {
        readonly waitedMsP50: number | null;
        readonly waitedMsP95: number | null;
        readonly waitedMsP99: number | null;
        readonly totalQueueWaitMs: number;
        readonly maxDepth: number;
        readonly starvationSignals: number;
    };
    readonly correctness: Record<BrokerCorrectness, number>;
    readonly pendingNotCountedAsSuccess: true;
    readonly sourceAvailability: TelemetrySourceAvailability;
    readonly missingTelemetry: readonly string[];
    readonly configDigest: string;
    readonly historyDigest: string;
}
export declare function observeBrokerDecision(input: BrokerDecisionTraceInput): BrokerDecisionObservation;
export declare function classifyBrokerOutcome(input: {
    readonly decision: BrokerDecisionObservation;
    readonly outcome?: BrokerOutcomeTraceInput | null;
    readonly now?: string;
    readonly pendingThresholdMs?: number;
    readonly ownerReviewRef?: string | null;
    readonly backlogExit?: string | null;
}): BrokerOutcomeClassification;
export declare function buildBrokerDecisionTelemetrySummary(input: {
    readonly taskId: string;
    readonly decisions: readonly BrokerDecisionObservation[];
    readonly outcomes: readonly BrokerOutcomeClassification[];
    readonly generatedAt?: string;
    readonly configDigest?: string;
}): BrokerDecisionTelemetrySummary;
export declare function brokerDecisionTelemetryConfig(): Readonly<Record<string, unknown>>;
