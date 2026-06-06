export interface CacheKeyComponents {
    atomId: string;
    atomVersion?: string;
    atomCid?: string;
    inputHash: string;
    policyHash: string;
    toolVersion: string;
    runtimeProfile?: string;
}
export interface CacheEntry {
    key: string;
    keyComponents: CacheKeyComponents;
    cachedAt: string;
    output: unknown;
}
export interface CacheHitResult {
    hit: true;
    output: unknown;
    key: string;
    keyComponents: CacheKeyComponents;
    cachedAt: string;
}
export interface CacheMissResult {
    hit: false;
    reason: string;
}
export type CacheLookupResult = CacheHitResult | CacheMissResult;
export declare function computeAtomCacheKey(components: CacheKeyComponents): string;
export declare function computeInputHash(input: unknown): string;
export declare function isAtomCacheable(atomRole: string | undefined): boolean;
export declare function getCacheEntry(repositoryRoot: string, mapId: string, key: string): CacheLookupResult;
export declare function setCacheEntry(repositoryRoot: string, mapId: string, key: string, components: CacheKeyComponents, output: unknown): void;
export declare function invalidateAtomCache(repositoryRoot: string, mapId: string, atomId: string): number;
export declare function clearMapCache(repositoryRoot: string, mapId: string): {
    removedFiles: number;
};
