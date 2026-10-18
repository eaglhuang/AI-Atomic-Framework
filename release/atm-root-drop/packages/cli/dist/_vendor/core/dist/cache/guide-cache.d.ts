export interface CacheKey {
    goal: string;
    glob: string;
    gitCommitHash: string;
    toolVersion: string;
    policyHash: string;
}
export interface CacheEntry {
    schemaId: 'atm.guideCacheEntry';
    cacheKey: string;
    keyComponents: CacheKey;
    cachedAt: string;
    contentHash: string;
    result: unknown;
}
export interface CacheIndexEntry {
    cacheKey: string;
    cachedAt: string;
    goal: string;
    gitCommitHash: string;
}
export interface CacheIndex {
    entries: Record<string, CacheIndexEntry>;
    updatedAt: string;
}
export interface CacheStatus {
    enabled: boolean;
    entryCount: number;
    totalBytes: number;
    oldestEntry: string | null;
    newestEntry: string | null;
}
export declare function getCacheDir(repositoryRoot: string): string;
export declare function isCacheEnabled(repositoryRoot: string): boolean;
export declare function enableGuideCache(repositoryRoot: string): void;
export declare function disableGuideCache(repositoryRoot: string): void;
export declare function computeCacheKey(components: CacheKey): string;
export declare function getGitCommitHash(repositoryRoot: string): string | null;
export declare function hasUncommittedChanges(repositoryRoot: string): boolean;
export declare function getPolicyHash(repositoryRoot: string): string;
export declare function readCacheEntry(repositoryRoot: string, cacheKey: string): CacheEntry | null;
export declare function writeCacheEntry(repositoryRoot: string, cacheKey: string, components: CacheKey, result: unknown): void;
export declare function clearCache(repositoryRoot: string, options?: {
    goalFilter?: string;
}): {
    clearedEntries: number;
    freedBytes: number;
};
export declare function getCacheStatus(repositoryRoot: string): CacheStatus;
