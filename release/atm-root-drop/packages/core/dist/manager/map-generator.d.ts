export declare function generateAtomicMap(request: any, options?: any): any;
export declare function createMinimalAtomicMapSpec(request: any): {
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
    members: ({
        versionLineage?: any;
        role?: undefined;
        atomId: string;
        version: string;
    } | {
        versionLineage?: any;
        role: string;
        atomId: string;
        version: string;
    })[];
    edges: ({
        edgeKind?: undefined;
        from: string;
        to: string;
        binding: string;
    } | {
        edgeKind: string;
        from: string;
        to: string;
        binding: string;
    })[];
    entrypoints: string[];
    qualityTargets: {
        [k: string]: string | number | boolean;
    };
    mapHash: string;
};
