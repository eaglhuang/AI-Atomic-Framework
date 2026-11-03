export type MapEntryStatus = 'active' | 'superseded' | 'rolled-back' | 'corrupted' | 'advisory';
export interface MapRegistryEntry {
    mapId: string;
    humanName: string;
    memberAtomCids: string[];
    exportedAt: string;
    exportedBy?: string;
    previousMapCid: string | null;
    nextMapCid: string | null;
    status: MapEntryStatus;
    storageLocations: string[];
    advisories: string[];
}
export interface MapRegistry {
    schemaVersion: 'atm.map-registry.v0.1';
    updatedAt: string;
    currentPointers: Record<string, string>;
    entries: Record<string, MapRegistryEntry>;
}
export declare function loadMapRegistry(registryPath: string): MapRegistry;
export declare function saveMapRegistry(registry: MapRegistry, registryPath: string): void;
export declare function getGlobalMapRegistryPath(): string;
export declare function getRepoMapRegistryPath(repositoryRoot: string): string;
export declare function upsertMapEntry(registry: MapRegistry, mapCid: string, entry: Partial<MapRegistryEntry> & {
    mapId: string;
    humanName: string;
    memberAtomCids: string[];
}): void;
export declare function linkMapChain(registry: MapRegistry, previousMapCid: string, nextMapCid: string): void;
export declare function markMapRolledBack(registry: MapRegistry, mapCid: string): void;
export declare function getMapEntry(registry: MapRegistry, mapCid: string): MapRegistryEntry | undefined;
export declare function getCurrentMapCid(registry: MapRegistry, mapId: string): string | undefined;
