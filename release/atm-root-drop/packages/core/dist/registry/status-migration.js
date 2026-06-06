import { normalizeRegistryGovernanceTier, resolveRegistryDefaultGovernanceTier, isRegistryEntryStatus } from './status-machine.js';
export const legacyRegistryStatusMigrationMap = {
    seed: { status: 'active', governanceTier: 'foundation' },
    active: { status: 'active', governanceTier: 'standard' },
    experimental: { status: 'validated', governanceTier: 'standard' },
    deprecated: { status: 'deprecated', governanceTier: 'standard' },
    governed: { status: 'active', governanceTier: 'governed' }
};
export function migrateRegistryStatus(input) {
    const rawStatus = String(input.status ?? '').trim();
    const legacyMigration = rawStatus ? legacyRegistryStatusMigrationMap[rawStatus] : undefined;
    const status = legacyMigration?.status ?? (isRegistryEntryStatus(rawStatus) ? rawStatus : (input.entryType === 'map' ? 'draft' : 'active'));
    const governanceTier = normalizeRegistryGovernanceTier(input.governanceTier ?? legacyMigration?.governanceTier ?? resolveRegistryDefaultGovernanceTier(status, input.entryType));
    return {
        status,
        governance: {
            tier: governanceTier
        },
        legacyStatus: legacyMigration ? rawStatus : null
    };
}
export function migrateRegistryEntryRecord(entry, entryType) {
    const migrated = migrateRegistryStatus({
        entryType,
        status: entry.status,
        governanceTier: entry.governance?.tier ?? null
    });
    return {
        ...entry,
        status: migrated.status,
        governance: migrated.governance
    };
}
