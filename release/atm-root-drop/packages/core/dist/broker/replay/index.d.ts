import { type SharedWriteGateCoverage } from '../census/index.js';
export * from './lifecycle-receipts.js';
export * from './runner-discrimination.js';
export * from './dashboard.js';
export type ReplayFailureClass = 'stale-current-allowed-task' | 'dimension-mismatch' | 'release-order-divergence' | 'closure-packet-divergence';
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
    readonly commandReceipts?: readonly ParallelReplayCommandReceipt[];
}
export interface ParallelReplayCommandReceipt {
    readonly command: string;
    readonly startedAtMs: number;
    readonly finishedAtMs: number;
    readonly exitCode: number;
    readonly stdoutDigest: string;
    readonly stderrDigest: string;
    readonly brokerTicketState?: string | null;
    readonly waitedMs?: number | null;
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
    readonly realTaskDogfood?: ParallelReplayDogfoodEvidence;
    readonly digest: string;
}
export interface ParallelReplayDogfoodTaskTrace {
    readonly taskId: string;
    readonly actorId: string;
    readonly declaredIntersection: readonly string[];
    readonly preservedIntersection: boolean;
    readonly canonicalTicketState: string | null;
    readonly waitedMs: number;
    readonly successorWakeup: boolean;
    readonly closurePacketDigest: string;
    readonly lifecycle: readonly string[];
}
export interface ParallelReplayDogfoodEvidence {
    readonly schemaId: 'atm.parallelReplayDogfoodEvidence.v1';
    readonly taskCount: number;
    readonly actorCount: number;
    readonly declaredIntersection: readonly string[];
    readonly preservedIntersection: boolean;
    readonly terminalRefusalCount: number;
    readonly manualWakeupCount: number;
    readonly closurePacketPollutionCount: number;
    readonly traces: readonly ParallelReplayDogfoodTaskTrace[];
    readonly digest: string;
}
export declare function buildParallelReplayScenario(input: ParallelReplayScenarioInput): ParallelReplayScenario;
export declare function evaluateParallelReplayScenario(scenario: ParallelReplayScenario): ParallelReplayEvaluation;
export declare function buildParallelReplayEvidence(input: {
    readonly scenario: ParallelReplayScenario;
    readonly workerReceipts: readonly ParallelReplayWorkerReceipt[];
    readonly thresholds?: Partial<ParallelReplayThresholds>;
    readonly faultCounters?: Partial<ParallelReplayFaultCounters>;
    readonly unavailableReceipts?: readonly string[];
    readonly serialMakespanMs?: number;
    readonly parallelMakespanMs?: number;
    readonly costRatio?: number;
    readonly realTaskDogfood?: ParallelReplayDogfoodEvidence;
}): ParallelReplayEvidence;
export declare function buildParallelReplayDogfoodEvidence(input: {
    readonly declaredIntersection: readonly string[];
    readonly traces: readonly (Omit<ParallelReplayDogfoodTaskTrace, 'closurePacketDigest'> & {
        readonly closurePacketDigest?: string;
    })[];
}): ParallelReplayDogfoodEvidence;
