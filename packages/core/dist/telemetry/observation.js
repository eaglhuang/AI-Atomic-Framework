export const telemetryObservationProducerInventory = Object.freeze([
    {
        producerId: 'evidence.command-runs',
        ownerTaskId: 'ATM-GOV-0205',
        status: 'canonical',
        sourcePaths: ['packages/cli/src/commands/evidence/command-runs.ts'],
        adapterPort: 'buildCommandRunObservation',
        notes: 'Canary producer for command-backed evidence timing, digests, cache status, and runner identity.'
    },
    {
        producerId: 'gate.telemetry-events',
        ownerTaskId: 'ATM-GOV-0197',
        status: 'adapter-backed',
        sourcePaths: ['packages/core/src/telemetry/index.ts', 'packages/cli/src/commands/telemetry.ts'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Gate telemetry already has timing/correlation fields; 0197 owns runtime storage/session lifecycle migration.'
    },
    {
        producerId: 'validator.lifecycle',
        ownerTaskId: 'ATM-GOV-0200',
        status: 'not-yet-migrated',
        sourcePaths: ['packages/cli/src/commands/evidence/validator-classification.ts', 'packages/cli/src/commands/validate.ts'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Validator lifecycle and tiering remain downstream; missing data must be partial, never fabricated.'
    },
    {
        producerId: 'runner.incremental-build',
        ownerTaskId: 'ATM-GOV-0201',
        status: 'not-yet-migrated',
        sourcePaths: ['scripts/run-sealed-runner-build.ts'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Live runner/build samples and dominant phase timing belong to 0201.'
    },
    {
        producerId: 'broker.decision-outcome',
        ownerTaskId: 'ATM-GOV-0199',
        status: 'not-yet-migrated',
        sourcePaths: ['packages/core/src/broker/**', 'packages/cli/src/commands/broker/**'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Broker correctness events keep domain-specific schemas and share only timing/correlation/digest/storage boundary fields.'
    },
    {
        producerId: 'plan-executor.phase',
        ownerTaskId: 'ATM-GOV-0198',
        status: 'canonical',
        sourcePaths: ['packages/cli/src/commands/batch/**', 'packages/core/src/batch/**'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Plan executor phase observations expose resumable phase, ticket, revalidation, and exactly-once side-effect digests.'
    },
    {
        producerId: 'test-runner.timing',
        ownerTaskId: 'ATM-GOV-0202',
        status: 'legacy-readable',
        sourcePaths: ['scripts/run-validators.ts', 'tests/cli/**'],
        adapterPort: 'TelemetryObservationBase',
        notes: 'Existing test timing is reader-compatible but not yet a first-class canonical producer.'
    }
]);
export function normalizeTelemetryDurationMs(value) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 0)
        return undefined;
    return Math.trunc(numeric);
}
export function normalizeTelemetryTimestamp(value) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return undefined;
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp))
        return undefined;
    return new Date(timestamp).toISOString();
}
export function buildTelemetryObservation(input) {
    const startedAt = normalizeTelemetryTimestamp(input.timing?.startedAt);
    const finishedAt = normalizeTelemetryTimestamp(input.timing?.finishedAt);
    const observedAt = normalizeTelemetryTimestamp(input.timing?.observedAt)
        ?? finishedAt
        ?? normalizeTelemetryTimestamp(input.timing?.generatedAt)
        ?? new Date().toISOString();
    return {
        schemaId: 'atm.telemetryObservation.v1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Canonical telemetry observation contract.'
        },
        observationId: input.observationId,
        producerId: input.producerId,
        producerVersion: input.producerVersion ?? '0.1.0',
        observationKind: input.observationKind,
        status: input.status ?? 'canonical',
        source: input.source,
        sourceAvailability: input.sourceAvailability ?? 'available',
        storagePolicy: input.storagePolicy ?? 'tracked-compact-digest',
        generatedAt: normalizeTelemetryTimestamp(input.timing?.generatedAt),
        observedAt,
        startedAt,
        finishedAt,
        durationMs: normalizeTelemetryDurationMs(input.timing?.durationMs),
        actorId: input.correlation?.actorId,
        runId: input.correlation?.runId,
        correlationId: input.correlation?.correlationId,
        laneSessionId: input.correlation?.laneSessionId ?? null,
        taskId: input.correlation?.taskId ?? null,
        batchId: input.correlation?.batchId ?? null,
        waveId: input.correlation?.waveId ?? null,
        inputDigest: input.inputDigest,
        outputDigest: input.outputDigest,
        configDigest: input.configDigest,
        cache: input.cacheKey || typeof input.cached === 'boolean'
            ? {
                key: input.cacheKey,
                hit: input.cached
            }
            : undefined,
        extensions: input.extensions
    };
}
