import { createHash } from 'node:crypto';
import { buildTelemetryObservation } from '../observation.js';
export function observeBrokerDecision(input) {
    try {
        const warnings = [];
        const requestedFiles = normalizeList(input.requestedFiles);
        const conflictSet = normalizeList(input.conflictSet);
        const redaction = redactConflictTrace(requestedFiles, conflictSet);
        if (redaction.warning)
            warnings.push(redaction.warning);
        const timing = {
            observedAt: input.observedAt,
            startedAt: input.startedAt,
            finishedAt: input.finishedAt,
            durationMs: input.durationMs ?? input.latencyMs
        };
        const correlation = {
            actorId: input.actorId,
            runId: input.runId,
            correlationId: input.decisionId,
            laneSessionId: input.laneSessionId ?? null,
            taskId: input.taskId,
            waveId: input.waveId ?? null
        };
        const sourceAvailability = warnings.length > 0 ? 'partial' : 'available';
        const observation = buildTelemetryObservation({
            observationId: input.decisionId,
            producerId: 'broker.decision-outcome',
            observationKind: 'broker-decision',
            status: 'canonical',
            source: 'packages/core/src/telemetry/broker/decision-outcome.ts',
            sourceAvailability,
            storagePolicy: 'runtime-raw-tracked-digest',
            timing,
            correlation,
            inputDigest: digestJson({ requestedFiles: redaction.requestedFileHashes, conflictSet: redaction.conflictSetHashes }),
            outputDigest: digestJson({ disposition: input.disposition, compositionDecision: input.compositionDecision ?? 'not-candidate' }),
            configDigest: input.configDigest ?? digestJson(brokerDecisionTelemetryConfig()),
            extensions: {
                eligibleOpportunity: input.eligibleOpportunity,
                parallelAdmissionMode: input.parallelAdmissionMode,
                disposition: input.disposition,
                outcomeJoinKey: input.decisionId
            }
        });
        return {
            schemaId: 'atm.brokerDecisionObservation.v1',
            specVersion: '0.1.0',
            decisionId: input.decisionId,
            observedAt: observation.observedAt ?? new Date().toISOString(),
            eligibleOpportunity: input.eligibleOpportunity,
            parallelAdmissionMode: input.parallelAdmissionMode,
            admissionReason: input.admissionReason,
            conflictAxes: normalizeList(input.conflictAxes),
            redactedConflictDigest: redaction.digest,
            requestedFileCount: requestedFiles.length,
            conflictSetCount: conflictSet.length,
            structuredOverlap: {
                kind: input.structuredOverlap?.kind ?? 'unavailable',
                confidence: boundedRatio(input.structuredOverlap?.confidence)
            },
            anchorResolutionRate: boundedRatio(input.anchorResolutionRate),
            disposition: input.disposition,
            compositionDecision: input.compositionDecision ?? 'not-candidate',
            fallbackReason: input.fallbackReason ?? null,
            sideEffectAllowance: input.sideEffectAllowance,
            waitedMs: nonNegative(input.waitedMs),
            latencyMs: nonNegative(input.latencyMs ?? input.durationMs),
            queue: normalizeQueue(input.queue),
            compose: normalizeCompose(input.compose),
            readWriteSet: normalizeReadWriteSet(input.readWriteSet),
            rulingClass: input.rulingClass ?? 'none',
            observation,
            sourceAvailability,
            warnings
        };
    }
    catch (error) {
        return failOpenDecision(input, error);
    }
}
export function classifyBrokerOutcome(input) {
    const now = input.now ?? new Date().toISOString();
    const ageMs = Math.max(0, Date.parse(now) - Date.parse(input.decision.observedAt));
    const pendingThresholdMs = Math.max(1, input.pendingThresholdMs ?? 24 * 60 * 60 * 1000);
    const outcome = input.outcome ?? null;
    if (!outcome) {
        const escalated = ageMs >= pendingThresholdMs;
        return outcomeClassification({
            outcomeRef: `pending:${input.decision.decisionId}`,
            decisionId: input.decision.decisionId,
            classifiedAt: now,
            correctness: 'pending',
            reason: escalated ? 'pending outcome exceeded aging threshold' : 'outcome not observed yet',
            ageMs,
            ownerReviewRef: input.ownerReviewRef ?? null,
            backlogExit: escalated ? (input.backlogExit ?? 'ATM-BUG-2026-07-19-036') : null
        });
    }
    const correctness = decideCorrectness(input.decision, outcome);
    return outcomeClassification({
        outcomeRef: outcome.outcomeRef,
        decisionId: input.decision.decisionId,
        classifiedAt: now,
        correctness: correctness.kind,
        reason: correctness.reason,
        ageMs,
        ownerReviewRef: outcome.manualReviewRef ?? input.ownerReviewRef ?? null,
        backlogExit: correctness.kind === 'escaped' || correctness.kind === 'false-negative'
            ? (input.backlogExit ?? 'ATM-BUG-2026-07-19-036')
            : null,
        outcome
    });
}
export function buildBrokerDecisionTelemetrySummary(input) {
    const decisions = [...input.decisions].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    const outcomesByDecision = new Map(input.outcomes.map((outcome) => [outcome.decisionId, outcome]));
    const missingTelemetry = new Set();
    for (const decision of decisions) {
        if (decision.sourceAvailability !== 'available')
            missingTelemetry.add(`decision:${decision.decisionId}`);
        if (!outcomesByDecision.has(decision.decisionId))
            missingTelemetry.add(`outcome:${decision.decisionId}`);
    }
    const correctness = zeroCorrectness();
    for (const outcome of input.outcomes)
        correctness[outcome.correctness] += 1;
    const waits = decisions.map((decision) => decision.waitedMs).filter((value) => typeof value === 'number').sort((a, b) => a - b);
    const composeCosts = decisions.map((decision) => decision.compose.compositionCostMs).filter((value) => value > 0).sort((a, b) => a - b);
    return {
        schemaId: 'atm.brokerDecisionTelemetrySummary.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        window: {
            start: decisions[0]?.observedAt ?? null,
            end: decisions[decisions.length - 1]?.observedAt ?? null
        },
        decisionCount: decisions.length,
        eligibleOpportunities: decisions.filter((decision) => decision.eligibleOpportunity).length,
        parallelAdmission: countBy(decisions, 'parallelAdmissionMode', ['parallel-first', 'policy-pre-serialize', 'surface-cannot-parallel']),
        dispositions: countBy(decisions, 'disposition', ['execute-now', 'batch', 'queue', 'hard-reject']),
        composition: {
            candidate: decisions.filter((decision) => decision.compositionDecision !== 'not-candidate').length,
            selected: decisions.filter((decision) => decision.compositionDecision === 'candidate-selected').length,
            skipped: decisions.filter((decision) => decision.compositionDecision === 'candidate-skipped').length,
            savedSerializationDepth: decisions.reduce((sum, decision) => sum + decision.compose.savedSerializationDepth, 0),
            compositionCostMsP95: percentile(composeCosts, 0.95)
        },
        queue: {
            waitedMsP50: percentile(waits, 0.5),
            waitedMsP95: percentile(waits, 0.95),
            waitedMsP99: percentile(waits, 0.99),
            totalQueueWaitMs: waits.reduce((sum, value) => sum + value, 0),
            maxDepth: Math.max(0, ...decisions.map((decision) => decision.queue.depth)),
            starvationSignals: decisions.filter((decision) => decision.queue.agingMs > 0 && decision.queue.bypassCount > 0).length
        },
        correctness,
        pendingNotCountedAsSuccess: true,
        sourceAvailability: missingTelemetry.size > 0 || decisions.some((decision) => decision.sourceAvailability !== 'available') ? 'partial' : 'available',
        missingTelemetry: [...missingTelemetry].sort(),
        configDigest: input.configDigest ?? digestJson(brokerDecisionTelemetryConfig()),
        historyDigest: digestJson({
            decisions: decisions.map((decision) => decision.observation.outputDigest),
            outcomes: input.outcomes.map((outcome) => [outcome.decisionId, outcome.correctness, outcome.join.commitSha])
        })
    };
}
export function brokerDecisionTelemetryConfig() {
    return Object.freeze({
        schemaId: 'atm.brokerDecisionTelemetryConfig.v1',
        correctnessStates: ['correct', 'false-positive', 'false-negative', 'escaped', 'manual-overridden', 'pending'],
        rawTracePolicy: 'runtime-raw-tracked-digest',
        pendingThresholdDefaultMs: 86400000,
        successExcludesPending: true
    });
}
function decideCorrectness(decision, outcome) {
    if (outcome.manualReviewRef)
        return { kind: 'manual-overridden', reason: 'manual review overrode automated classification' };
    if ((outcome.downstreamIncidentRefs?.length ?? 0) > 0 || outcome.rollbackRef)
        return { kind: 'escaped', reason: 'downstream incident or rollback observed after decision' };
    if (decision.disposition === 'hard-reject' || decision.disposition === 'queue') {
        if (outcome.serialOracle === 'compatible' && outcome.semanticResult !== 'fail') {
            return { kind: 'false-positive', reason: 'decision serialized or rejected a later-compatible outcome' };
        }
        return { kind: 'correct', reason: 'protective decision matched incompatible or unknown outcome' };
    }
    if ((decision.disposition === 'execute-now' || decision.disposition === 'batch') && outcome.serialOracle === 'incompatible') {
        return { kind: 'false-negative', reason: 'parallel or batch decision admitted an incompatible outcome' };
    }
    if (outcome.semanticResult === 'fail')
        return { kind: 'false-negative', reason: 'semantic revalidation failed after admission' };
    return { kind: 'correct', reason: 'decision and joined outcome are compatible' };
}
function outcomeClassification(input) {
    const outcome = input.outcome;
    return {
        schemaId: 'atm.brokerOutcomeClassification.v1',
        specVersion: '0.1.0',
        outcomeRef: input.outcomeRef,
        decisionId: input.decisionId,
        classifiedAt: input.classifiedAt,
        correctness: input.correctness,
        reason: input.reason,
        ageMs: input.ageMs,
        pendingEscalation: {
            escalated: input.correctness === 'pending' && Boolean(input.backlogExit),
            ownerReviewRef: input.ownerReviewRef,
            backlogExit: input.backlogExit
        },
        join: {
            commitSha: outcome?.commitSha ?? null,
            fileSliceDigest: digestJson(normalizeList(outcome?.fileSlices)),
            validatorDigest: digestJson(normalizeList(outcome?.validatorRefs)),
            rollbackRef: outcome?.rollbackRef ?? null,
            downstreamIncidentDigest: digestJson(normalizeList(outcome?.downstreamIncidentRefs)),
            semanticResult: outcome?.semanticResult ?? 'unknown',
            serialOracle: outcome?.serialOracle ?? 'unknown',
            sideEffectActual: outcome?.sideEffectActual ?? 'not-attempted'
        }
    };
}
function failOpenDecision(input, error) {
    const now = input.observedAt ?? new Date().toISOString();
    const warning = error instanceof Error ? error.message : String(error);
    const observation = buildTelemetryObservation({
        observationId: input.decisionId || `broker-decision-${digestJson(input).slice(7, 23)}`,
        producerId: 'broker.decision-outcome',
        observationKind: 'broker-decision',
        status: 'canonical',
        source: 'packages/core/src/telemetry/broker/decision-outcome.ts',
        sourceAvailability: 'partial',
        storagePolicy: 'runtime-raw-tracked-digest',
        timing: { observedAt: now },
        correlation: { actorId: input.actorId, taskId: input.taskId, laneSessionId: input.laneSessionId ?? null }
    });
    return {
        schemaId: 'atm.brokerDecisionObservation.v1',
        specVersion: '0.1.0',
        decisionId: input.decisionId || observation.observationId,
        observedAt: observation.observedAt ?? now,
        eligibleOpportunity: Boolean(input.eligibleOpportunity),
        parallelAdmissionMode: input.parallelAdmissionMode ?? 'policy-pre-serialize',
        admissionReason: input.admissionReason ?? 'fail-open observation fallback',
        conflictAxes: [],
        redactedConflictDigest: digestJson({ warning }),
        requestedFileCount: 0,
        conflictSetCount: 0,
        structuredOverlap: { kind: 'unavailable', confidence: 0 },
        anchorResolutionRate: 0,
        disposition: input.disposition ?? 'queue',
        compositionDecision: 'not-candidate',
        fallbackReason: 'telemetry observation failed open',
        sideEffectAllowance: input.sideEffectAllowance ?? 'deferred',
        waitedMs: null,
        latencyMs: null,
        queue: normalizeQueue(),
        compose: normalizeCompose(),
        readWriteSet: normalizeReadWriteSet(),
        rulingClass: input.rulingClass ?? 'none',
        observation,
        sourceAvailability: 'partial',
        warnings: [warning]
    };
}
function redactConflictTrace(requestedFiles, conflictSet) {
    const requestedFileHashes = requestedFiles.map(hashToken).sort();
    const conflictSetHashes = conflictSet.map(hashToken).sort();
    return {
        digest: digestJson({ requestedFileHashes, conflictSetHashes }),
        requestedFileHashes,
        conflictSetHashes,
        warning: requestedFiles.some((value) => looksSecret(value)) || conflictSet.some((value) => looksSecret(value))
            ? 'secret-like broker trace token was redacted'
            : null
    };
}
function normalizeQueue(value) {
    return {
        depth: Math.max(0, Math.trunc(value?.depth ?? 0)),
        position: Math.max(0, Math.trunc(value?.position ?? 0)),
        agingMs: Math.max(0, Math.trunc(value?.agingMs ?? 0)),
        bypassCount: Math.max(0, Math.trunc(value?.bypassCount ?? 0)),
        wakeupKey: value?.wakeupKey ?? null
    };
}
function normalizeCompose(value) {
    return {
        candidateCount: Math.max(0, Math.trunc(value?.candidateCount ?? 0)),
        selectedCount: Math.max(0, Math.trunc(value?.selectedCount ?? 0)),
        skippedCount: Math.max(0, Math.trunc(value?.skippedCount ?? 0)),
        compositionCostMs: Math.max(0, Math.trunc(value?.compositionCostMs ?? 0)),
        savedSerializationDepth: Math.max(0, Math.trunc(value?.savedSerializationDepth ?? 0)),
        serializabilityVerdict: value?.serializabilityVerdict ?? 'unknown',
        partialCompose: Boolean(value?.partialCompose)
    };
}
function normalizeReadWriteSet(value) {
    return {
        readSetDigest: value?.readSetDigest ?? null,
        writeSetDigest: value?.writeSetDigest ?? null,
        intersectionKind: value?.intersectionKind ?? null,
        revalidationResult: value?.revalidationResult ?? 'not-required'
    };
}
function zeroCorrectness() {
    return {
        correct: 0,
        'false-positive': 0,
        'false-negative': 0,
        escaped: 0,
        'manual-overridden': 0,
        pending: 0
    };
}
function countBy(items, key, values) {
    const output = Object.fromEntries(values.map((value) => [value, 0]));
    for (const item of items)
        output[item[key]] += 1;
    return output;
}
function percentile(values, p) {
    if (values.length === 0)
        return null;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
    return values[index] ?? null;
}
function normalizeList(values) {
    return [...new Set((values ?? []).map((value) => String(value).trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}
function nonNegative(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return Math.max(0, Math.trunc(value));
}
function boundedRatio(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function hashToken(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function looksSecret(value) {
    return /(sk-|token=|authorization|password|secret)/i.test(value);
}
