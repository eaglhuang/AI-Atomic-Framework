import type { MapRegistryEntryRecord, RegistryDocument, RegistryEntryRecord, RegistryVersionRecord } from '../index';
export interface RegistryVersionHistoryMigrationOptions {
    readonly defaultVersion?: string;
    readonly timestamp?: string;
}
export interface RegistryEntryWithVersionHistory extends RegistryEntryRecord {
    readonly currentVersion?: string;
    readonly versions?: readonly RegistryVersionRecord[];
}
export interface RegistryDocumentWithVersionHistory extends Omit<RegistryDocument, 'entries'> {
    readonly entries: readonly (RegistryEntryWithVersionHistory | MapRegistryEntryRecord)[];
}
export declare function upcastRegistryDocumentVersionHistory(registryDocument: RegistryDocument, options?: RegistryVersionHistoryMigrationOptions): RegistryDocumentWithVersionHistory;
export declare function upcastRegistryEntryVersionHistory(entry: RegistryEntryRecord, options?: RegistryVersionHistoryMigrationOptions): RegistryEntryWithVersionHistory;
export declare function normalizeRegistryVersionHistory(entry: RegistryEntryRecord, options?: RegistryVersionHistoryMigrationOptions): readonly RegistryVersionRecord[];
export declare function createRegistryVersionRecord(entry: RegistryEntryRecord, version: string, timestamp?: string): RegistryVersionRecord;
