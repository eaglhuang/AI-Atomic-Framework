import type { AtomicMapReplacementRecord, RegistryMapEdgeRecord, RegistryMapMemberRecord } from '../index.ts';
interface MapMember {
    atomId: string;
    version: string;
    role?: string;
    versionLineage?: string;
}
interface MapEdge {
    from: string;
    to: string;
    binding: string;
    edgeKind?: string;
}
interface MapReplacement {
    legacyUris: string[];
    mode?: string;
    evidenceRefs?: string[];
}
interface NormalizedRequest {
    members: MapMember[];
    edges: MapEdge[];
    entrypoints: string[];
    qualityTargets: Record<string, string | number | boolean>;
    mapVersion: string;
    specVersion?: string;
    replacement?: MapReplacement | null;
    pendingSfCalculation?: boolean;
}
interface GenerateAtomicMapOptions {
    repositoryRoot?: string;
    registryPath?: string;
    dryRun?: boolean;
    force?: boolean;
    mapId?: string | null;
    status?: string;
    governanceTier?: string;
    catalogPath?: string;
    now?: string;
    overwriteExisting?: boolean;
    testContent?: string;
    registryDocument?: Record<string, unknown>;
}
/** Unified result shape returned by generateAtomicMap */
export interface GenerateAtomicMapResult {
    ok: boolean;
    mapId: string | null;
    workbenchPath?: string | null;
    specPath?: string | null;
    testPath?: string | null;
    reportPath?: string | null;
    registryEntry?: RegistryEntry | null;
    registryPath?: string | null;
    catalogPath?: string | null;
    allocation?: MapIdAllocationRecord | null;
    testRun?: unknown | null;
    idempotent?: boolean;
    dryRun?: boolean;
    phases: PhaseRecord[];
    failedPhase?: string | null;
    error?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
interface PhaseRecord {
    phase: string;
    ok: boolean;
    durationMs: number;
    error?: ReturnType<typeof normalizeError>;
}
interface RegistryEntry {
    mapId: string;
    schemaId?: string;
    specVersion?: string;
    mapVersion?: string;
    members?: readonly RegistryMapMemberRecord[];
    edges?: readonly RegistryMapEdgeRecord[];
    replacement?: AtomicMapReplacementRecord;
    evidence?: readonly string[];
    location?: {
        workbenchPath?: string;
        specPath?: string;
        testPaths?: string[];
        reportPath?: string;
    };
}
interface MapIdAllocationRecord {
    mapId: string;
    bucket: string;
    sequence: number;
    source: string;
    reservation: string | null;
}
export declare function generateAtomicMap(request: unknown, options?: GenerateAtomicMapOptions): GenerateAtomicMapResult;
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
declare function normalizeError(error: unknown): {
    code: string;
    message: string;
    details: Record<string, unknown>;
};
export {};
