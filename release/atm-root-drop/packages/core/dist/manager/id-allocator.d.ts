export declare class AtomIdAllocationError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, text: string, details?: Record<string, unknown>);
}
export declare function normalizeAtomBucket(bucket: any): string;
export declare function parseAtomId(atomId: any): {
    atomId: string;
    bucket: string;
    sequence: number;
} | null;
export declare function allocateAtomId(bucket: any, options?: any): {
    atomId: string;
    bucket: string;
    sequence: any;
    source: string;
    reservation: null;
};
