import type { KnowledgeHit, KnowledgeIndexEntry, KnowledgeMetadata } from './types.ts';
import { resolveKnowledgeOutputs } from './runtime-utils.ts';
export declare function buildFilters(options: Record<string, unknown>): {
    repo: string | undefined;
    channel: string | undefined;
    domain: string | undefined;
    path: string | undefined;
    atom: string | undefined;
    validator: string | undefined;
};
export declare function rankKnowledgeHits(entries: KnowledgeIndexEntry[], query: string, filters: ReturnType<typeof buildFilters>, top: number, cwd: string): KnowledgeHit[];
export declare function buildHybridRequest(options: Record<string, unknown>): {
    enabled: boolean;
};
export declare function applyHybridRerank(input: {
    cwd: string;
    outputs: ReturnType<typeof resolveKnowledgeOutputs>;
    query: string;
    lexicalShortlist: KnowledgeHit[];
    top: number;
}): {
    hits: KnowledgeHit[];
    evidence: Record<string, any>;
};
export declare function summarizeHitReason(hit: {
    metadata?: KnowledgeMetadata;
    score: number;
}, taskId: string): string;
export declare function deriveQueryText(cwd: string, options: Record<string, unknown>): string;
