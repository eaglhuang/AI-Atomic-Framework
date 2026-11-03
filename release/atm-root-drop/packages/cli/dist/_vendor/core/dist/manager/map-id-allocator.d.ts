export declare class MapIdAllocationError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, text: string, details?: Record<string, unknown>);
}
interface MapRegistryDocumentLike {
    entries?: unknown[];
}
interface AllocateMapIdOptions {
    repositoryRoot?: string;
    registryPath?: string;
    registryDocument?: MapRegistryDocumentLike | null;
}
export declare function parseMapId(mapId: unknown): {
    mapId: string;
    bucket: string;
    sequence: number;
} | null;
export declare function allocateMapId(options?: AllocateMapIdOptions): {
    mapId: string;
    bucket: string;
    sequence: number;
    source: string;
    reservation: null;
};
export {};
