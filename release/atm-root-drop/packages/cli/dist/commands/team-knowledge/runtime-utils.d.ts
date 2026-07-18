import type { KnowledgeIndex, RuntimeBudgetStatus } from './types.ts';
export declare function parsePositiveInteger(value: unknown, fallback: number, max: number): number;
export declare function parseByteLimit(value: unknown, fallback: number): number;
export declare function evaluateRuntimeBudget(runtimeCacheBytes: number, warningBytes: number, hardLimitBytes: number): {
    runtimeCacheBytes: number;
    warningBytes: number;
    hardLimitBytes: number;
    status: RuntimeBudgetStatus;
    diagnostic: string;
};
export declare function resolveKnowledgeOutputs(cwd: string): {
    canonicalRoot: string;
    canonicalRootRelative: string;
    runtimeRoot: string;
    runtimeRootRelative: string;
    manifestPath: string;
    indexPath: string;
    embeddingCachePath: string;
    manifestRelative: string;
    indexRelative: string;
    embeddingCacheRelative: string;
};
export declare function buildManifest(index: KnowledgeIndex, outputs: ReturnType<typeof resolveKnowledgeOutputs>): {
    schemaId: string;
    advisoryOnly: boolean;
    generatedAt: string;
    shardCount: number;
    canonicalRoot: string;
    lexicalIndex: string;
    optionalEmbeddingCache: string;
};
export declare function walkFiles(dir: string): string[];
export declare function isKnowledgeShardFile(file: string): boolean;
export declare function fileSize(file: string): number;
export declare function isRuntimePrunableCache(filePath: string): boolean;
export declare function isInsidePath(root: string, candidate: string): boolean;
export declare function resolveBudgetOptions(options: Record<string, unknown>): {
    warningBytes: number;
    hardLimitBytes: number;
};
