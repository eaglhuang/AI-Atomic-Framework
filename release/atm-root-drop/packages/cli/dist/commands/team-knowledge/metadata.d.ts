import type { KnowledgeIndex, KnowledgeIndexEntry, KnowledgeMetadata, KnowledgeShardRetention } from './types.ts';
export declare function buildKnowledgeIndex(cwd: string, scope: string): KnowledgeIndex;
export declare function buildKnowledgeStats(cwd: string, options: Record<string, unknown>): {
    schemaId: string;
    advisoryOnly: boolean;
    canonicalRoot: string;
    runtimeRoot: string;
    shardCount: number;
    runtimeIndexBytes: number;
    runtimeCacheBytes: number;
    embeddingCacheBytes: number;
    staleShardCount: number;
    supersededShardCount: number;
    archiveCandidateCount: number;
    budget: {
        runtimeCacheBytes: number;
        warningBytes: number;
        hardLimitBytes: number;
        status: import("./types.ts").RuntimeBudgetStatus;
        diagnostic: string;
    };
    shards: KnowledgeShardRetention[];
    runtimeFiles: {
        path: string;
        bytes: number;
        prunable: boolean;
    }[];
};
export declare function inspectKnowledgeShard(cwd: string, file: string): KnowledgeShardRetention;
export declare function buildIndexEntry(cwd: string, file: string): KnowledgeIndexEntry;
export declare function extractMetadata(body: string, relativePath: string): {
    title: string;
    metadata: KnowledgeMetadata;
};
