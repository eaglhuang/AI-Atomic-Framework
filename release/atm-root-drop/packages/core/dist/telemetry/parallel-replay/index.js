import { sha256Digest } from '../../broker/census/index.js';
export function buildParallelReplayTelemetryProof(evidence) {
    const withoutDigest = {
        schemaId: 'atm.parallelReplayTelemetryProof.v1',
        evidenceDigest: evidence.digest,
        correctness: {
            escapedConflictCount: evidence.faultCounters.escapedConflictCount,
            silentOverwriteCount: evidence.faultCounters.silentOverwriteCount,
            duplicateSideEffectCount: evidence.faultCounters.duplicateSideEffectCount,
            unresolvedStarvationCount: evidence.faultCounters.unresolvedStarvationCount,
            staleAuthorizationCount: evidence.faultCounters.staleAuthorizationCount,
            dimensionMismatchedAuthorizationCount: evidence.faultCounters.dimensionMismatchedAuthorizationCount,
            decisionContradictionCount: evidence.faultCounters.decisionContradictionCount
        },
        timing: {
            maxConcurrentWorkers: evidence.maxConcurrentWorkers,
            overlapWindowMs: evidence.overlapWindowMs,
            parallelOverlapRatio: evidence.parallelOverlapRatio,
            serializedAdmissionRatio: evidence.serializedAdmissionRatio,
            throughputGainRatio: evidence.throughputGainRatio,
            costRatio: evidence.costRatio
        },
        breaker: {
            verdict: evidence.verdict,
            unexpectedBreakerTripCount: evidence.faultCounters.unexpectedBreakerTripCount,
            timeInQueueOnlyRatio: evidence.timeInQueueOnlyRatio
        },
        coverageWatermark: {
            workerCount: evidence.workerCount,
            parallelAdmissionCount: evidence.parallelAdmissionCount,
            unavailableReceiptCount: evidence.unavailableReceipts.length
        }
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}
