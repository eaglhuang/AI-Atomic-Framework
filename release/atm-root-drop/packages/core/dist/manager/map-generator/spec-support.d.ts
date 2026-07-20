import type { HashPayloadInput, MapEdge, MapMember, NormalizedRequest } from './types.ts';
export declare function createMinimalAtomicMapSpec(request: NormalizedRequest & {
    mapId: string;
}): {
    pendingSfCalculation?: boolean | undefined;
    semanticFingerprint: string | null;
    replacement?: {
        legacyUris: string[];
        mode: string;
        evidenceRefs: string[];
    } | undefined;
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    mapId: string;
    mapVersion: string;
    members: MapMember[];
    edges: MapEdge[];
    entrypoints: string[];
    qualityTargets: Record<string, string | number | boolean>;
    mapHash: string;
};
export declare function normalizeRequest(request: unknown): NormalizedRequest;
export declare function computeAtomicMapHash(input: HashPayloadInput): string;
