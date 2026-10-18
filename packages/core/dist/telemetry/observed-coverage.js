export function buildObservedCoverageReport(input) {
    const selection = selectEligibleRuntimeEvents([...input.historyEvents.valid, ...input.runtimeEvents.valid]);
    const malformedEvents = input.historyEvents.malformed + input.runtimeEvents.malformed;
    const requiredNodes = input.requiredNodes.map((node) => assessObservedNodeCoverage(node, selection.events, malformedEvents));
    const m2Comparable = malformedEvents === 0 && selection.invalidEventIdCount === 0 && requiredNodes.every((node) => node.m2Comparable);
    return {
        schemaId: 'atm.gateTelemetryRegistryCoverageReport.v1',
        generatedAt: new Date().toISOString(),
        configDigest: input.digest({
            checks: input.checks,
            requiredNodes: requiredNodes.map(({ nodeId, coverageStatus, requiredCorrelationKeys }) => ({ nodeId, coverageStatus, requiredCorrelationKeys }))
        }),
        historyDigest: input.digest({
            eventCount: selection.events.length,
            checkIds: [...new Set(selection.events.map((event) => event.checkId))].sort(),
            excludedIneligibleEvents: selection.excludedIneligibleCount,
            excludedBySource: selection.excludedBySource,
            duplicateEventIds: selection.duplicateEventIdCount,
            invalidEventIds: selection.invalidEventIdCount,
            malformedEvents
        }),
        requiredNodes,
        droppedEvents: 0,
        malformedEvents,
        eventSelection: {
            eligibleRuntimeEvents: selection.events.length,
            excludedIneligibleEvents: selection.excludedIneligibleCount,
            excludedBySource: selection.excludedBySource,
            duplicateEventIds: selection.duplicateEventIdCount,
            invalidEventIds: selection.invalidEventIdCount
        },
        m2Comparable,
        m2PreflightVerdict: m2Comparable ? 'ready' : 'inconclusive',
        rawDataPolicy: {
            runtimeStorage: '.atm/runtime/telemetry/**',
            trackedEvidence: 'compact-digest-only',
            rawTelemetryCommitted: false
        }
    };
}
export function selectEligibleRuntimeEvents(events) {
    const accepted = new Map();
    const excludedBySource = {};
    let excludedIneligibleCount = 0;
    let duplicateEventIdCount = 0;
    let invalidEventIdCount = 0;
    for (const event of events) {
        if (!event.eligible) {
            excludedIneligibleCount += 1;
            continue;
        }
        if (event.source !== 'runtime') {
            excludedBySource[event.source] = (excludedBySource[event.source] ?? 0) + 1;
            continue;
        }
        if (!event.eventId?.trim()) {
            invalidEventIdCount += 1;
            continue;
        }
        if (accepted.has(event.eventId)) {
            duplicateEventIdCount += 1;
            continue;
        }
        accepted.set(event.eventId, event);
    }
    return { events: [...accepted.values()], excludedIneligibleCount, excludedBySource, duplicateEventIdCount, invalidEventIdCount };
}
export function assessObservedNodeCoverage(node, observedEvents, malformedEventCount = 0) {
    if (node.coverageStatus !== 'instrumented' || node.producerCheckIds.length === 0)
        return node;
    const events = observedEvents.filter((event) => node.producerCheckIds.includes(event.checkId));
    const observedProducerCheckIds = [...new Set(events.map((event) => event.checkId))].sort();
    const missingProducerCheckIds = node.producerCheckIds.filter((checkId) => !observedProducerCheckIds.includes(checkId));
    const missingCorrelationKeys = node.requiredCorrelationKeys.filter((key) => events.some((event) => {
        const value = event[key];
        return typeof value !== 'string' || !value.trim() || value.trim().toLowerCase() === 'unknown';
    }));
    const missingTelemetry = [...new Set([
            ...node.missingTelemetry,
            ...missingCorrelationKeys,
            ...(!events.length ? ['observedEvents'] : []),
            ...missingProducerCheckIds.map((checkId) => `observedProducer:${checkId}`),
            ...(malformedEventCount > 0 ? ['malformedEvents'] : []),
            ...events.flatMap((event) => event.result !== 'block' ? [] : [
                ...(!event.reasonClass || ['block', 'unknown', 'error'].includes(event.reasonClass.trim().toLowerCase()) ? ['blockReason'] : []),
                ...(!event.errorCode?.trim() ? ['blockErrorCode'] : []),
                ...(!event.failureEnvelopeRef?.trim() ? ['failureEnvelopeRef'] : [])
            ])
        ])].sort();
    const sourceAvailability = !events.length ? 'unavailable' : missingTelemetry.length ? 'partial' : node.sourceAvailability;
    return {
        ...node,
        observedProducerCheckIds,
        missingProducerCheckIds,
        missingCorrelationKeys,
        missingTelemetry,
        sourceAvailability,
        m2Comparable: node.m2Comparable && missingProducerCheckIds.length === 0 && malformedEventCount === 0 && !missingTelemetry.length
    };
}
