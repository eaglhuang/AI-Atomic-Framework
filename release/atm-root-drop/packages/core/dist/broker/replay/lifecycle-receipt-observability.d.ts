import type { AppendOnlyEvidenceWrite, BrokerDecisionOutcomePair, EventDerivedCorrectnessCounters, LifecycleReceiptVerdict, TelemetryCoverageState, TelemetryNodeCoverageObservation, TelemetryObligationSealInput, TelemetryObligationSealResult } from './lifecycle-receipt-types.js';
export declare function deriveEventDerivedCorrectnessCounters(input: {
    readonly observations?: Partial<Record<'escapedConflict' | 'silentOverwrite' | 'duplicateSideEffect' | 'unresolvedStarvation' | 'staleAuthorization' | 'dimensionMismatchedAuthorization' | 'decisionContradiction' | 'unexpectedBreakerTrip', number | null | undefined>>;
}): EventDerivedCorrectnessCounters;
export declare function buildBrokerDecisionOutcomePair(input: Omit<BrokerDecisionOutcomePair, 'schemaId' | 'digest'> & {
    readonly digest?: string;
}): BrokerDecisionOutcomePair;
export declare function classifyTelemetryCoverageState(node: TelemetryNodeCoverageObservation): TelemetryCoverageState;
export declare function registryMembershipSatisfiesCoverage(node: TelemetryNodeCoverageObservation): boolean;
export declare function evaluateTelemetryObligationSeal(input: TelemetryObligationSealInput): TelemetryObligationSealResult;
/**
 * Concurrent task-scoped evidence writers must preserve both records
 * (append-only / leased). Last-write-wins that drops a peer record is rejected.
 */
export declare function mergeAppendOnlyEvidenceWrites(existing: readonly AppendOnlyEvidenceWrite[], incoming: readonly AppendOnlyEvidenceWrite[]): {
    readonly schemaId: 'atm.parallelReplayAppendOnlyEvidenceMerge.v1';
    readonly records: readonly AppendOnlyEvidenceWrite[];
    readonly lostUpdateCount: number;
    readonly verdict: LifecycleReceiptVerdict;
};
