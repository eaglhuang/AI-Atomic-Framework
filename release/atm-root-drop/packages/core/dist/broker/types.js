const FROZEN_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'broker format adapter subsystem baseline'
});
/** Shared default migration record for adapter-emitted envelopes. */
export function brokerAdapterMigration() {
    return FROZEN_MIGRATION;
}
