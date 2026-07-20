import type { MapRegistryEntryRecord, RegistryEntryRecord, RegistryEntryStatus, RegistryGovernanceRecord, RegistryGovernanceTier } from '../index';
export declare const legacyRegistryStatusMigrationMap: Readonly<Record<string, {
    readonly status: RegistryEntryStatus;
    readonly governanceTier: RegistryGovernanceTier;
}>>;
export interface RegistryStatusMigrationInput {
    readonly entryType: 'atom' | 'map';
    readonly status?: string | null;
    readonly governanceTier?: string | null;
}
export interface RegistryStatusMigrationResult {
    readonly status: RegistryEntryStatus;
    readonly governance: RegistryGovernanceRecord;
    readonly legacyStatus: string | null;
}
export declare function migrateRegistryStatus(input: RegistryStatusMigrationInput): RegistryStatusMigrationResult;
export declare function migrateRegistryEntryRecord<T extends RegistryEntryRecord | MapRegistryEntryRecord>(entry: T, entryType: 'atom' | 'map'): T & {
    readonly status: RegistryEntryStatus;
    readonly governance: RegistryGovernanceRecord;
};
