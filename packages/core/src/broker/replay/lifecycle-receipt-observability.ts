import { sha256Digest } from '../census/index.ts';
import type {
  AppendOnlyEvidenceWrite,
  BrokerDecisionOutcomePair,
  CorrectnessCounterValue,
  EventDerivedCorrectnessCounters,
  LifecycleReceiptVerdict,
  TelemetryCoverageState,
  TelemetryNodeCoverageObservation,
  TelemetryObligationSealInput,
  TelemetryObligationSealResult
} from './lifecycle-receipt-types.ts';

export function deriveEventDerivedCorrectnessCounters(input: {
  readonly observations?: Partial<Record<
    | 'escapedConflict'
    | 'silentOverwrite'
    | 'duplicateSideEffect'
    | 'unresolvedStarvation'
    | 'staleAuthorization'
    | 'dimensionMismatchedAuthorization'
    | 'decisionContradiction'
    | 'unexpectedBreakerTrip',
    number | null | undefined
  >>;
}): EventDerivedCorrectnessCounters {
  const observations = input.observations ?? {};
  const withoutDigest = {
    schemaId: 'atm.parallelReplayCorrectnessCounters.v1' as const,
    escapedConflict: toCounter(observations.escapedConflict),
    silentOverwrite: toCounter(observations.silentOverwrite),
    duplicateSideEffect: toCounter(observations.duplicateSideEffect),
    unresolvedStarvation: toCounter(observations.unresolvedStarvation),
    staleAuthorization: toCounter(observations.staleAuthorization),
    dimensionMismatchedAuthorization: toCounter(observations.dimensionMismatchedAuthorization),
    decisionContradiction: toCounter(observations.decisionContradiction),
    unexpectedBreakerTrip: toCounter(observations.unexpectedBreakerTrip)
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

export function buildBrokerDecisionOutcomePair(input: Omit<BrokerDecisionOutcomePair, 'schemaId' | 'digest'> & {
  readonly digest?: string;
}): BrokerDecisionOutcomePair {
  if (!input.outcomeRef || input.outcomeRef.trim().length === 0) {
    throw new Error('broker decision/outcome pairs require an immutable outcomeRef');
  }
  const withoutDigest = {
    schemaId: 'atm.brokerDecisionOutcomePair.v1' as const,
    decisionClass: input.decisionClass,
    conflictAxes: [...input.conflictAxes],
    composeOrQueueResult: input.composeOrQueueResult,
    waitMs: input.waitMs,
    reworkCount: input.reworkCount,
    ownerOverride: input.ownerOverride,
    delayedCorrectnessOutcome: input.delayedCorrectnessOutcome,
    outcomeRef: input.outcomeRef
  };
  return {
    ...withoutDigest,
    digest: input.digest ?? sha256Digest(withoutDigest)
  };
}

export function classifyTelemetryCoverageState(node: TelemetryNodeCoverageObservation): TelemetryCoverageState {
  if (node.sealedReadBackCount > 0) return 'sealed-read-back';
  if (node.observedEventCount > 0) return 'observed';
  if (node.codeWired) return 'code-wired';
  return 'registered';
}

export function registryMembershipSatisfiesCoverage(node: TelemetryNodeCoverageObservation): boolean {
  const state = classifyTelemetryCoverageState(node);
  return state === 'observed' || state === 'sealed-read-back';
}

export function evaluateTelemetryObligationSeal(input: TelemetryObligationSealInput): TelemetryObligationSealResult {
  const declared = [...new Set(input.declaredObligations.map((entry) => entry.trim()).filter(Boolean))];
  const hasSeal = typeof input.sealedSummaryDigest === 'string' && input.sealedSummaryDigest.startsWith('sha256:');
  const hasUnavailable = typeof input.unavailableReceiptDigest === 'string' && input.unavailableReceiptDigest.startsWith('sha256:');
  const missing = hasSeal || hasUnavailable ? [] : declared;
  const sealed = hasSeal || hasUnavailable;
  const verdict = hasSeal
    ? 'complete'
    : hasUnavailable
      ? 'observability-missing'
      : 'incomplete';
  const withoutDigest = {
    schemaId: 'atm.parallelReplayTelemetryObligationSeal.v1' as const,
    taskId: input.taskId,
    sealed,
    verdict: verdict as TelemetryObligationSealResult['verdict'],
    missingObligations: missing,
    recoveryCommand: sealed
      ? null
      : `node atm.mjs telemetry --seal --task ${input.taskId} --json`,
    compactEvidenceDigest: hasSeal
      ? input.sealedSummaryDigest!
      : hasUnavailable
        ? input.unavailableReceiptDigest!
        : null
  };
  return {
    ...withoutDigest,
    digest: sha256Digest({
      ...withoutDigest,
      historyDigest: input.historyDigest ?? null,
      configDigest: input.configDigest ?? null
    })
  };
}

/**
 * Concurrent task-scoped evidence writers must preserve both records
 * (append-only / leased). Last-write-wins that drops a peer record is rejected.
 */
export function mergeAppendOnlyEvidenceWrites(
  existing: readonly AppendOnlyEvidenceWrite[],
  incoming: readonly AppendOnlyEvidenceWrite[]
): {
  readonly schemaId: 'atm.parallelReplayAppendOnlyEvidenceMerge.v1';
  readonly records: readonly AppendOnlyEvidenceWrite[];
  readonly lostUpdateCount: number;
  readonly verdict: LifecycleReceiptVerdict;
} {
  const byId = new Map<string, AppendOnlyEvidenceWrite>();
  for (const record of existing) byId.set(record.recordId, record);
  let lostUpdateCount = 0;
  for (const record of incoming) {
    const prior = byId.get(record.recordId);
    if (prior && prior.payloadDigest !== record.payloadDigest && prior.writerId !== record.writerId) {
      byId.set(`${record.recordId}::${record.writerId}`, record);
    } else if (prior && prior.payloadDigest !== record.payloadDigest && prior.writerId === record.writerId) {
      byId.set(record.recordId, record);
    } else {
      byId.set(record.recordId, record);
    }
  }
  const records = [...byId.values()].sort((left, right) => left.observedAtMs - right.observedAtMs || left.recordId.localeCompare(right.recordId));
  const expectedMin = new Set([
    ...existing.map((entry) => `${entry.recordId}:${entry.payloadDigest}`),
    ...incoming.map((entry) => `${entry.recordId}:${entry.payloadDigest}`)
  ]).size;
  const preservedDigests = new Set(records.map((entry) => `${entry.recordId.split('::')[0]}:${entry.payloadDigest}`));
  const preserved = preservedDigests.size >= expectedMin;
  if (!preserved) lostUpdateCount = expectedMin - preservedDigests.size;
  return {
    schemaId: 'atm.parallelReplayAppendOnlyEvidenceMerge.v1',
    records,
    lostUpdateCount,
    verdict: preserved ? 'accepted' : 'rejected'
  };
}

function toCounter(value: number | null | undefined): CorrectnessCounterValue {
  if (value === null || value === undefined) {
    return { status: 'unavailable', reason: 'required-observation-absent' };
  }
  if (!Number.isFinite(value) || value < 0) {
    return { status: 'inconclusive', reason: 'observation-not-finite-or-negative' };
  }
  return { status: 'observed', value };
}
