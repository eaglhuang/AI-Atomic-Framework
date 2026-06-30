export declare class AtomIdAllocationError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, text: string, details?: Record<string, unknown>);
}
interface AtomRegistryDocumentLike {
    entries?: unknown[];
}
interface AllocateAtomIdOptions {
    repositoryRoot?: string;
    registryPath?: string;
    registryDocument?: AtomRegistryDocumentLike | null;
}
export declare function normalizeAtomBucket(bucket: unknown): string;
export declare function parseAtomId(atomId: unknown): {
    atomId: string;
    bucket: string;
    sequence: number;
} | null;
export declare function allocateAtomId(bucket: unknown, options?: AllocateAtomIdOptions): {
    atomId: string;
    bucket: string;
    sequence: number;
    source: string;
    reservation: null;
};
export {};
