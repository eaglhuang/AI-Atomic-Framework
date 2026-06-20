const FROZEN_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'broker format adapter subsystem baseline'
});
/** Shared default migration record for adapter-emitted envelopes. */
export function brokerAdapterMigration() {
    return FROZEN_MIGRATION;
}
const ROUTE_FREEZE_RUNTIME_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'Route pause/freeze runtime sidecar bound to broker freeze protocol.'
});
export function createRouteFreezeRuntimeRecord(input) {
    return {
        schemaId: 'atm.routeFreezeRuntime.v1',
        specVersion: '0.1.0',
        migration: ROUTE_FREEZE_RUNTIME_MIGRATION,
        routeId: input.routeId,
        signal: input.signal,
        ack: input.ack,
        resolution: input.resolution,
        pauseReason: input.pauseReason,
        updatedAt: input.updatedAt
    };
}
