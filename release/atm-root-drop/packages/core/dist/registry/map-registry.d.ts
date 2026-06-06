import type { AtomicMapRecord, MapRegistryEntryRecord, RegistryLocationRecord } from '../index';
export interface CreateAtomicMapRegistryEntryOptions {
    readonly schemaPath?: string;
    readonly semanticFingerprint?: string | null;
    readonly lineageLogRef?: string;
    readonly ttl?: number;
    readonly pendingSfCalculation?: boolean;
    readonly status?: string | null;
    readonly governanceTier?: string | null;
    readonly location?: RegistryLocationRecord;
    readonly evidence?: readonly string[];
}
export declare function createAtomicMapRegistryEntry(atomicMap: AtomicMapRecord, options?: CreateAtomicMapRegistryEntryOptions): MapRegistryEntryRecord;
export declare function isAtomicMapRegistryEntry(value: unknown): value is MapRegistryEntryRecord;
export declare function validateAtomicMapRegistryEntryHash(entry: MapRegistryEntryRecord): {
    ok: boolean;
    actual: string;
    expected: string;
};
