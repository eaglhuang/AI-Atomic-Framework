export interface AtomBundle {
    canonicalSourceCode: string;
    inputSchema: unknown;
    outputSchema: unknown;
    policeConfig: unknown;
}
export interface AtomCapsule {
    cid: string;
    bundle: AtomBundle;
    compressedPayload: string;
}
export interface CapsuleImportResult {
    cid: string;
    bundlePath: string;
    verified: boolean;
    fromCache: boolean;
    warnings: string[];
}
export declare class AtomCapsuleError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function computeAtomCid(bundle: AtomBundle): string;
export declare function exportAtomCapsule(bundle: AtomBundle): AtomCapsule;
export declare function importAtomCapsule(cid: string, compressedPayload: string, options?: {
    vendorDir?: string;
    repositoryRoot?: string;
}): CapsuleImportResult;
export declare function verifyPayloadHash(cid: string, compressedPayload: string): boolean;
export declare function parseCid(cid: string): {
    prefix: string;
    hash: string;
};
export declare function cidToShortId(cid: string): string;
export declare function validateCidFormat(cid: string): void;
