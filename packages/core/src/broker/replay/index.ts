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

