export function buildTeamObservabilityContract() {
    return {
        schemaId: 'atm.teamAgentObservabilityContract.v1',
        eventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        queryResultSchemaId: 'atm.teamAgentObservabilityQueryResult.v1',
        providerNeutral: true,
        queryKeys: ['taskId', 'teamRunId', 'providerId', 'role', 'artifactType', 'eventType'],
        eventTypes: [
            'session.start',
            'step.execution',
            'tool.invocation',
            'artifact.output',
            'session.complete',
            'session.failure',
            'broker.conflict.blocked',
            'broker.conflict.resolution',
            'handoff.materialized',
            'handoff.consumed',
            'handoff.integrity-blocked',
            'handoff.archived'
        ],
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        redactionPolicy: {
            rawSecretsLogged: false,
            rawSecretsAllowed: false,
            governanceEvidenceOnly: true
        }
    };
}
export function createTeamObservabilityEvent(input) {
    const emittedAt = input.emittedAt?.trim() || new Date().toISOString();
    const taskId = normalizeRequired(input.taskId, 'taskId');
    const role = normalizeRequired(input.role, 'role');
    const providerId = input.providerId ?? 'unknown';
    const artifactType = nullableString(input.artifactType);
    const artifactId = nullableString(input.artifactId);
    const decisionClass = nullableString(input.decisionClass);
    const violationStatus = nullableString(input.violationStatus);
    return {
        schemaId: 'atm.teamAgentObservabilityEvent.v1',
        specVersion: '0.1.0',
        eventId: `TAO-${stableSuffix([
            input.eventType,
            taskId,
            String(input.teamRunId ?? ''),
            providerId,
            role,
            artifactType ?? '',
            artifactId ?? '',
            emittedAt
        ])}`,
        emittedAt,
        eventType: input.eventType,
        taskId,
        teamRunId: nullableString(input.teamRunId),
        providerId,
        role,
        runtimeMode: input.runtimeMode ?? 'broker-only',
        artifactType,
        artifactId,
        decisionClass,
        decisionReason: nullableString(input.decisionReason),
        violationStatus,
        statusCode: nullableString(input.statusCode),
        summary: normalizeRequired(input.summary, 'summary'),
        redaction: {
            rawSecretsLogged: false,
            redactedFields: [...(input.redactedFields ?? [])]
        },
        evidenceBoundary: {
            governanceEvidenceOnly: true,
            rawSecretsAllowed: false
        }
    };
}
export function createBrokerConflictObservabilityEvents(input) {
    const { artifact } = input;
    const base = {
        taskId: artifact.primaryTaskId,
        teamRunId: input.teamRunId ?? null,
        providerId: input.providerId ?? 'unknown',
        role: input.role ?? 'coordinator',
        runtimeMode: 'broker-only',
        artifactType: artifact.artifactType,
        artifactId: artifact.resolutionId,
        decisionClass: artifact.decisionClass,
        decisionReason: artifact.decisionReason,
        violationStatus: artifact.violationStatus,
        statusCode: artifact.statusCode,
        emittedAt: input.emittedAt
    };
    return [
        createTeamObservabilityEvent({
            ...base,
            eventType: 'broker.conflict.blocked',
            summary: `broker-conflict-blocked for ${artifact.primaryTaskId}; blocked=${artifact.blockedTaskIds.join(',') || 'none'}`
        }),
        createTeamObservabilityEvent({
            ...base,
            eventType: 'broker.conflict.resolution',
            summary: `resolution ${artifact.resolutionId} release order: ${artifact.releaseOrder.join(' -> ')}`
        })
    ];
}
export function queryTeamObservabilityEvents(events, filters) {
    const normalizedFilters = normalizeQuery(filters);
    const matching = events.filter((event) => {
        return matches(event.taskId, normalizedFilters.taskId)
            && matches(event.teamRunId, normalizedFilters.teamRunId)
            && matches(event.providerId, normalizedFilters.providerId)
            && matches(event.role, normalizedFilters.role)
            && matches(event.artifactType, normalizedFilters.artifactType)
            && matches(event.eventType, normalizedFilters.eventType);
    });
    return {
        schemaId: 'atm.teamAgentObservabilityQueryResult.v1',
        specVersion: '0.1.0',
        filters: normalizedFilters,
        eventCount: matching.length,
        events: matching
    };
}
function normalizeQuery(filters) {
    return Object.fromEntries(Object.entries(filters)
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([, value]) => Boolean(value)));
}
function matches(value, expected) {
    return !expected || value === expected;
}
function nullableString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}
function normalizeRequired(value, fieldName) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new Error(`${fieldName} is required for Team observability events.`);
    }
    return normalized;
}
function stableSuffix(values) {
    let hash = 0;
    for (const value of values.join('|')) {
        hash = ((hash << 5) - hash + value.charCodeAt(0)) | 0;
    }
    return Math.abs(hash).toString(36).padStart(6, '0');
}
