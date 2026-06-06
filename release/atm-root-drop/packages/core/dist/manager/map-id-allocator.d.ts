export declare class MapIdAllocationError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, text: string, details?: Record<string, unknown>);
}
export declare function parseMapId(mapId: any): {
    mapId: string;
    bucket: string;
    sequence: number;
} | null;
export declare function allocateMapId(options?: any): {
    mapId: string;
    bucket: string;
    sequence: any;
    source: string;
    reservation: null;
};
