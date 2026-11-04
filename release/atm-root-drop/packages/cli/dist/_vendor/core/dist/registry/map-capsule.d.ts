export interface MapBundleMember {
    atomCid: string;
    role: string;
}
export interface MapBundleEdge {
    from: string;
    to: string;
    binding: string;
    edgeKind?: string;
}
export interface MapBundle {
    specVersion: string;
    members: MapBundleMember[];
    edges: MapBundleEdge[];
    entrypoints: string[];
    qualityTargets?: Record<string, string | number | boolean>;
}
export interface MapCapsule {
    mapCid: string;
    bundle: MapBundle;
    compressedPayload: string;
}
export interface MapCapsuleExportResult {
    mapCid: string;
    compressedPayload: string;
    memberAtomCids: string[];
    memberCapsules: Array<{
        atomCid: string;
        compressedPayload: string;
    }>;
}
export declare class MapCapsuleError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function computeMapCid(bundle: MapBundle): string;
export declare function exportMapCapsule(bundle: MapBundle): MapCapsule;
export declare function importMapCapsule(mapCid: string, compressedPayload: string, options?: {
    vendorDir?: string;
    repositoryRoot?: string;
}): {
    mapCid: string;
    bundle: MapBundle;
    bundlePath: string;
    verified: boolean;
};
export declare function convertSpecToMapBundle(mapSpec: {
    specVersion?: string;
    members: Array<{
        atomId: string;
        version?: string;
    }>;
    edges: Array<{
        from: string;
        to: string;
        binding: string;
        edgeKind?: string;
    }>;
    entrypoints: string[];
    qualityTargets?: Record<string, string | number | boolean>;
}, atomCidMap: Record<string, string>): MapBundle;
export declare function verifyMapPayloadHash(mapCid: string, compressedPayload: string): boolean;
export declare function validateMapCidFormat(mapCid: string): void;
export declare function mapCidToShortId(mapCid: string): string;
