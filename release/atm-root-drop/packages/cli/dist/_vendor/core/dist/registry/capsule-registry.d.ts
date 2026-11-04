export type CapsuleEntryStatus = 'active' | 'superseded' | 'rolled-back' | 'corrupted' | 'advisory';
export interface CapsuleRegistryEntry {
    atomId: string;
    humanName: string;
    sourceRepo?: string;
    sourceRef?: string;
    exportedAt: string;
    exportedBy?: string;
    previousCid: string | null;
    nextCid: string | null;
    status: CapsuleEntryStatus;
    storageLocations: string[];
    advisories: string[];
}
export interface CapsuleRegistry {
    schemaVersion: 'atm.capsule-registry.v0.1';
    updatedAt: string;
    entries: Record<string, CapsuleRegistryEntry>;
}
export declare function loadCapsuleRegistry(registryPath: string): CapsuleRegistry;
export declare function saveCapsuleRegistry(registry: CapsuleRegistry, registryPath: string): void;
export declare function getGlobalRegistryPath(): string;
export declare function getRepoRegistryPath(repositoryRoot: string): string;
export declare function upsertCapsuleEntry(registry: CapsuleRegistry, cid: string, entry: Partial<CapsuleRegistryEntry> & {
    atomId: string;
    humanName: string;
}): void;
export declare function linkCapsuleChain(registry: CapsuleRegistry, previousCid: string, nextCid: string): void;
export declare function markCapsuleCorrupted(registry: CapsuleRegistry, cid: string, corruptedLocation: string): void;
export declare function markCapsuleRolledBack(registry: CapsuleRegistry, cid: string): void;
export declare function addCapsuleAdvisory(registry: CapsuleRegistry, cid: string, advisory: string): void;
export declare function getCapsuleEntry(registry: CapsuleRegistry, cid: string): CapsuleRegistryEntry | undefined;
export declare function listAdvisoryCids(registry: CapsuleRegistry): string[];
export declare function syncRegistries(globalRegistry: CapsuleRegistry, repoRegistry: CapsuleRegistry, repoPath: string): void;
