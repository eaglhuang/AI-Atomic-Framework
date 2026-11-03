import type { ParallelReplayEvidence } from '../../broker/replay/index.js';
import { type TelemetryCoverageState, type TelemetryNodeCoverageObservation, type TelemetryObligationSealInput, type TelemetryObligationSealResult } from '../../broker/replay/lifecycle-receipts.js';
export interface ParallelReplayTelemetryProof {
    readonly schemaId: 'atm.parallelReplayTelemetryProof.v1';
    readonly evidenceDigest: string;
    readonly correctness: {
        readonly escapedConflictCount: number;
        readonly silentOverwriteCount: number;
        readonly duplicateSideEffectCount: number;
        readonly unresolvedStarvationCount: number;
        readonly staleAuthorizationCount: number;
        readonly dimensionMismatchedAuthorizationCount: number;
        readonly decisionContradictionCount: number;
    };
    readonly timing: {
        readonly maxConcurrentWorkers: number;
        readonly overlapWindowMs: number;
        readonly parallelOverlapRatio: number;
        readonly serializedAdmissionRatio: number;
        readonly throughputGainRatio: number;
        readonly costRatio: number;
    };
    readonly breaker: {
        readonly verdict: ParallelReplayEvidence['verdict'];
        readonly unexpectedBreakerTripCount: number;
        readonly timeInQueueOnlyRatio: number;
    };
    readonly coverageWatermark: {
        readonly workerCount: number;
        readonly parallelAdmissionCount: number;
        readonly unavailableReceiptCount: number;
    };
    readonly digest: string;
}
export interface ParallelReplayTelemetryCoverageReport {
    readonly schemaId: 'atm.parallelReplayTelemetryCoverageReport.v1';
    readonly nodes: readonly (TelemetryNodeCoverageObservation & {
        readonly coverageState: TelemetryCoverageState;
        readonly registryAloneSatisfies: false;
        readonly coverageSatisfied: boolean;
    })[];
    readonly digest: string;
}
export declare function buildParallelReplayTelemetryProof(evidence: ParallelReplayEvidence): ParallelReplayTelemetryProof;
export declare function buildParallelReplayTelemetryCoverageReport(nodes: readonly TelemetryNodeCoverageObservation[]): ParallelReplayTelemetryCoverageReport;
export declare function sealParallelReplayTelemetryObligation(input: TelemetryObligationSealInput): TelemetryObligationSealResult;
export type { TelemetryCoverageState, TelemetryNodeCoverageObservation, TelemetryObligationSealInput, TelemetryObligationSealResult };
