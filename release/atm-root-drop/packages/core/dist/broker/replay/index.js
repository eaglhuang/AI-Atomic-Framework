import { sha256Digest } from '../census/index.js';
export * from './lifecycle-receipts.js';
export function buildParallelReplayScenario(input) {
    const generatedAt = input.generatedAt ?? new Date(0).toISOString();
    const historicalInputDigest = sha256Digest(input.historicalInputs);
    const withoutDigest = {
        schemaId: 'atm.parallelReplayScenario.v1',
        specVersion: '0.1.0',
        scenarioId: input.scenarioId,
        generatedAt,
        runner: input.runner,
        thresholds: input.thresholds,
        coverageDigest: input.coverage.digest,
        historicalInputDigest,
        failureShapes: input.failureShapes,
        disallowFixedTaskActorPathBranches: true
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}
export function evaluateParallelReplayScenario(scenario) {
    const counters = scenario.failureShapes.reduce((accumulator, shape) => {
        accumulator[shape.failureClass] = (accumulator[shape.failureClass] ?? 0) + 1;
        return accumulator;
    }, {
        'stale-current-allowed-task': 0,
        'dimension-mismatch': 0,
        'release-order-divergence': 0,
        'closure-packet-divergence': 0
    });
    const failureCount = Object.values(counters).reduce((sum, value) => sum + value, 0);
    return {
        schemaId: 'atm.parallelReplayEvaluation.v1',
        scenarioDigest: scenario.digest,
        counters,
        redBaseline: failureCount > 0 ? 'red' : 'invalid',
        reason: failureCount > 0 ? 'frozen baseline retains at least one sealed failure class' : 'scenario has no discriminating failure shape'
    };
}
export function buildParallelReplayEvidence(input) {
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
        : 0;
    const costRatio = roundRatio(input.costRatio ?? 1);
    const withoutDigest = {
        schemaId: 'atm.parallelReplayEvidence.v1',
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
            ? 'queue-only'
            : unavailableReceipts.length > 0
                || throughputGainRatio <= 0
                || parallelOverlapRatio < thresholds.minimumParallelOverlapRatio
                || serializedAdmissionRatio > thresholds.maximumSerializedAdmissionRatio
                ? 'inconclusive'
                : 'pass',
        unavailableReceipts,
        workerReceipts,
        realTaskDogfood: input.realTaskDogfood
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}
export function buildParallelReplayDogfoodEvidence(input) {
    const traces = input.traces.map((trace) => ({
        ...trace,
        declaredIntersection: [...trace.declaredIntersection],
        lifecycle: [...trace.lifecycle],
        closurePacketDigest: trace.closurePacketDigest ?? sha256Digest({
            taskId: trace.taskId,
            actorId: trace.actorId,
            lifecycle: trace.lifecycle,
            declaredIntersection: trace.declaredIntersection
        })
    }));
    const terminalRefusalCount = traces.filter((trace) => trace.canonicalTicketState === 'refused' || trace.canonicalTicketState === 'blocked').length;
    const withoutDigest = {
        schemaId: 'atm.parallelReplayDogfoodEvidence.v1',
        taskCount: traces.length,
        actorCount: new Set(traces.map((trace) => trace.actorId)).size,
        declaredIntersection: [...input.declaredIntersection],
        preservedIntersection: traces.length > 0 && traces.every((trace) => trace.preservedIntersection),
        terminalRefusalCount,
        manualWakeupCount: traces.filter((trace) => !trace.successorWakeup).length,
        closurePacketPollutionCount: traces.filter((trace) => trace.lifecycle.includes('closure-packet-polluted')).length,
        traces
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}
function computeMakespanMs(receipts) {
    if (receipts.length === 0)
        return 0;
    return Math.max(...receipts.map((entry) => entry.finishedAtMs)) - Math.min(...receipts.map((entry) => entry.startedAtMs));
}
function computeOverlapWindowMs(receipts) {
    if (receipts.length < 2)
        return 0;
    const overlapStart = Math.max(...receipts.map((entry) => entry.startedAtMs));
    const overlapEnd = Math.min(...receipts.map((entry) => entry.finishedAtMs));
    return Math.max(0, overlapEnd - overlapStart);
}
function computeMaxConcurrentWorkers(receipts) {
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
function normalizeFaultCounters(input = {}) {
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
function roundRatio(value) {
    return Math.round(value * 1000) / 1000;
}
