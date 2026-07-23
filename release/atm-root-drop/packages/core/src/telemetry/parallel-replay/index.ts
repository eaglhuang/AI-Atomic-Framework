import { sha256Digest } from '../../broker/census/index.ts';
import type { ParallelReplayEvidence } from '../../broker/replay/index.ts';
import {
  classifyTelemetryCoverageState,
  evaluateTelemetryObligationSeal,
  registryMembershipSatisfiesCoverage,
  type TelemetryCoverageState,
  type TelemetryNodeCoverageObservation,
  type TelemetryObligationSealInput,
  type TelemetryObligationSealResult
} from '../../broker/replay/lifecycle-receipts.ts';

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

export function buildParallelReplayTelemetryProof(evidence: ParallelReplayEvidence): ParallelReplayTelemetryProof {
  const withoutDigest = {
    schemaId: 'atm.parallelReplayTelemetryProof.v1' as const,
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

export function buildParallelReplayTelemetryCoverageReport(
  nodes: readonly TelemetryNodeCoverageObservation[]
): ParallelReplayTelemetryCoverageReport {
  const enriched = nodes.map((node) => {
    const coverageState = classifyTelemetryCoverageState(node);
    return {
      ...node,
      coverageState,
      registryAloneSatisfies: false as const,
      coverageSatisfied: registryMembershipSatisfiesCoverage(node)
    };
  });
  const withoutDigest = {
    schemaId: 'atm.parallelReplayTelemetryCoverageReport.v1' as const,
    nodes: enriched
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

export function sealParallelReplayTelemetryObligation(
  input: TelemetryObligationSealInput
): TelemetryObligationSealResult {
  return evaluateTelemetryObligationSeal(input);
}

export type {
  TelemetryCoverageState,
  TelemetryNodeCoverageObservation,
  TelemetryObligationSealInput,
  TelemetryObligationSealResult
};
