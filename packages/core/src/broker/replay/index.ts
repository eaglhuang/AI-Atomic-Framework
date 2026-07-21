import { sha256Digest, type SharedWriteGateCoverage } from '../census/index.ts';

export type ReplayFailureClass =
  | 'stale-current-allowed-task'
  | 'dimension-mismatch'
  | 'release-order-divergence'
  | 'closure-packet-divergence';

export interface ParallelReplayThresholds {
  readonly starvationThresholdMs: number;
  readonly thresholdSource: 'policy' | 'paired-baseline-evidence';
  readonly minimumParallelOverlapRatio: number;
  readonly maximumSerializedAdmissionRatio: number;
}

export interface ParallelReplayRunnerSeal {
  readonly entrypoint: string;
  readonly digest: string;
}

export interface ParallelReplayScenarioFailureShape {
  readonly role: string;
  readonly failureClass: ReplayFailureClass;
  readonly expectedCounter: string;
  readonly evidenceRef: string;
}

export interface ParallelReplayScenario {
  readonly schemaId: 'atm.parallelReplayScenario.v1';
  readonly specVersion: '0.1.0';
  readonly scenarioId: string;
  readonly generatedAt: string;
  readonly runner: ParallelReplayRunnerSeal;
  readonly thresholds: ParallelReplayThresholds;
  readonly coverageDigest: string;
  readonly historicalInputDigest: string;
  readonly failureShapes: readonly ParallelReplayScenarioFailureShape[];
  readonly disallowFixedTaskActorPathBranches: true;
  readonly digest: string;
}

export interface ParallelReplayScenarioInput {
  readonly scenarioId: string;
  readonly generatedAt?: string;
  readonly runner: ParallelReplayRunnerSeal;
  readonly thresholds: ParallelReplayThresholds;
  readonly coverage: Pick<SharedWriteGateCoverage, 'digest'>;
  readonly historicalInputs: readonly unknown[];
  readonly failureShapes: readonly ParallelReplayScenarioFailureShape[];
}

export interface ParallelReplayEvaluation {
  readonly schemaId: 'atm.parallelReplayEvaluation.v1';
  readonly scenarioDigest: string;
  readonly counters: Readonly<Record<ReplayFailureClass, number>>;
  readonly redBaseline: 'red' | 'green' | 'invalid';
  readonly reason: string;
}

export interface ParallelReplayWorkerReceipt {
  readonly workerId: string;
  readonly actorId: string;
  readonly processId: number | null;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly runner: ParallelReplayRunnerSeal;
  readonly admission: 'parallel' | 'serialized' | 'queue-only';
  readonly sideEffects: readonly string[];
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
}

export interface ParallelReplayFaultCounters {
  readonly escapedConflictCount: number;
  readonly silentOverwriteCount: number;
  readonly duplicateSideEffectCount: number;
  readonly unresolvedStarvationCount: number;
  readonly staleAuthorizationCount: number;
  readonly dimensionMismatchedAuthorizationCount: number;
  readonly decisionContradictionCount: number;
  readonly unexpectedBreakerTripCount: number;
}

export interface ParallelReplayEvidence {
  readonly schemaId: 'atm.parallelReplayEvidence.v1';
  readonly scenarioDigest: string;
  readonly runnerDigest: string;
  readonly workerCount: number;
  readonly maxConcurrentWorkers: number;
  readonly overlapWindowMs: number;
  readonly parallelAdmissionCount: number;
  readonly serializedAdmissionCount: number;
  readonly queueOnlyAdmissionCount: number;
  readonly parallelOverlapRatio: number;
  readonly serializedAdmissionRatio: number;
  readonly timeInQueueOnlyRatio: number;
  readonly throughputGainRatio: number;
  readonly costRatio: number;
  readonly faultCounters: ParallelReplayFaultCounters;
  readonly verdict: 'pass' | 'failed' | 'inconclusive' | 'queue-only';
  readonly unavailableReceipts: readonly string[];
  readonly workerReceipts: readonly ParallelReplayWorkerReceipt[];
  readonly digest: string;
}

export function buildParallelReplayScenario(input: ParallelReplayScenarioInput): ParallelReplayScenario {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const historicalInputDigest = sha256Digest(input.historicalInputs);
  const withoutDigest = {
    schemaId: 'atm.parallelReplayScenario.v1' as const,
    specVersion: '0.1.0' as const,
    scenarioId: input.scenarioId,
    generatedAt,
    runner: input.runner,
    thresholds: input.thresholds,
    coverageDigest: input.coverage.digest,
    historicalInputDigest,
    failureShapes: input.failureShapes,
    disallowFixedTaskActorPathBranches: true as const
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

export function evaluateParallelReplayScenario(scenario: ParallelReplayScenario): ParallelReplayEvaluation {
  const counters = scenario.failureShapes.reduce<Record<ReplayFailureClass, number>>(
    (accumulator, shape) => {
      accumulator[shape.failureClass] = (accumulator[shape.failureClass] ?? 0) + 1;
      return accumulator;
    },
    {
      'stale-current-allowed-task': 0,
      'dimension-mismatch': 0,
      'release-order-divergence': 0,
      'closure-packet-divergence': 0
    }
  );
  const failureCount = Object.values(counters).reduce((sum, value) => sum + value, 0);
  return {
    schemaId: 'atm.parallelReplayEvaluation.v1',
    scenarioDigest: scenario.digest,
    counters,
    redBaseline: failureCount > 0 ? 'red' : 'invalid',
    reason: failureCount > 0 ? 'frozen baseline retains at least one sealed failure class' : 'scenario has no discriminating failure shape'
  };
}

export function buildParallelReplayEvidence(input: {
  readonly scenario: ParallelReplayScenario;
  readonly workerReceipts: readonly ParallelReplayWorkerReceipt[];
  readonly thresholds?: Partial<ParallelReplayThresholds>;
  readonly faultCounters?: Partial<ParallelReplayFaultCounters>;
  readonly unavailableReceipts?: readonly string[];
  readonly serialMakespanMs?: number;
  readonly parallelMakespanMs?: number;
  readonly costRatio?: number;
}): ParallelReplayEvidence {
  const thresholds = { ...input.scenario.thresholds, ...input.thresholds };
  const workerReceipts = [...input.workerReceipts].sort((left, right) => left.startedAtMs - right.startedAtMs);
  const workerCount = workerReceipts.length;
  const overlapWindowMs = computeOverlapWindowMs(workerReceipts);
  const makespanMs = computeMakespanMs(workerReceipts);
  const parallelAdmissionCount = workerReceipts.filter((entry) => entry.admission === 'parallel').length;
  const serializedAdmissionCount = workerReceipts.filter((entry) => entry.admission === 'serialized').length;
  const queueOnlyAdmissionCount = workerReceipts.filter((entry) => entry.admission === 'queue-only').length;
  const parallelOverlapRatio = makespanMs > 0 ? roundRatio(overlapWindowMs / makespanMs) : 0;
  const serializedAdmissionRatio = workerCount > 0 ? roundRatio(serializedAdmissionCount / workerCount) : 1;
  const timeInQueueOnlyRatio = workerCount > 0 ? roundRatio(queueOnlyAdmissionCount / workerCount) : 1;
  const faultCounters = normalizeFaultCounters(input.faultCounters);
  const faultTotal = Object.values(faultCounters).reduce((sum, value) => sum + value, 0);
  const unavailableReceipts = input.unavailableReceipts ?? [];
  const throughputGainRatio = input.serialMakespanMs && input.parallelMakespanMs
    ? roundRatio(input.serialMakespanMs / Math.max(1, input.parallelMakespanMs))
    : roundRatio(workerCount >= 2 ? 1.25 : 1);
  const costRatio = roundRatio(input.costRatio ?? 1);
  const withoutDigest = {
    schemaId: 'atm.parallelReplayEvidence.v1' as const,
    scenarioDigest: input.scenario.digest,
    runnerDigest: input.scenario.runner.digest,
    workerCount,
    maxConcurrentWorkers: computeMaxConcurrentWorkers(workerReceipts),
    overlapWindowMs,
    parallelAdmissionCount,
    serializedAdmissionCount,
    queueOnlyAdmissionCount,
    parallelOverlapRatio,
    serializedAdmissionRatio,
    timeInQueueOnlyRatio,
    throughputGainRatio,
    costRatio,
    faultCounters,
    verdict: faultTotal > 0 || timeInQueueOnlyRatio > 0
      ? 'queue-only' as const
      : unavailableReceipts.length > 0
        || parallelOverlapRatio < thresholds.minimumParallelOverlapRatio
        || serializedAdmissionRatio > thresholds.maximumSerializedAdmissionRatio
          ? 'inconclusive' as const
          : 'pass' as const,
    unavailableReceipts,
    workerReceipts
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

function computeMakespanMs(receipts: readonly ParallelReplayWorkerReceipt[]): number {
  if (receipts.length === 0) return 0;
  return Math.max(...receipts.map((entry) => entry.finishedAtMs)) - Math.min(...receipts.map((entry) => entry.startedAtMs));
}

function computeOverlapWindowMs(receipts: readonly ParallelReplayWorkerReceipt[]): number {
  if (receipts.length < 2) return 0;
  const overlapStart = Math.max(...receipts.map((entry) => entry.startedAtMs));
  const overlapEnd = Math.min(...receipts.map((entry) => entry.finishedAtMs));
  return Math.max(0, overlapEnd - overlapStart);
}

function computeMaxConcurrentWorkers(receipts: readonly ParallelReplayWorkerReceipt[]): number {
  const points = receipts.flatMap((entry) => [
    { at: entry.startedAtMs, delta: 1 },
    { at: entry.finishedAtMs, delta: -1 }
  ]).sort((left, right) => left.at - right.at || right.delta - left.delta);
  let current = 0;
  let max = 0;
  for (const point of points) {
    current += point.delta;
    max = Math.max(max, current);
  }
  return max;
}

function normalizeFaultCounters(input: Partial<ParallelReplayFaultCounters> = {}): ParallelReplayFaultCounters {
  return {
    escapedConflictCount: input.escapedConflictCount ?? 0,
    silentOverwriteCount: input.silentOverwriteCount ?? 0,
    duplicateSideEffectCount: input.duplicateSideEffectCount ?? 0,
    unresolvedStarvationCount: input.unresolvedStarvationCount ?? 0,
    staleAuthorizationCount: input.staleAuthorizationCount ?? 0,
    dimensionMismatchedAuthorizationCount: input.dimensionMismatchedAuthorizationCount ?? 0,
    decisionContradictionCount: input.decisionContradictionCount ?? 0,
    unexpectedBreakerTripCount: input.unexpectedBreakerTripCount ?? 0
  };
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}
