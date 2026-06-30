type AtmNodeKind = 'atom' | 'map' | 'police' | 'behavior';
interface NormalizeAtmNodeRefOptions {
    readonly nodeKind?: unknown;
    readonly version?: unknown;
}
export declare class AtmUrnError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function inferAtmNodeKind(canonicalId: unknown): AtmNodeKind;
export declare function formatAtmUrn(input: unknown): string;
export declare function parseAtmUrn(value: unknown): {
    urn: string;
    nodeKind: AtmNodeKind;
    canonicalId: string;
    version: string | null;
};
export declare function normalizeAtmNodeRef(value: unknown, options?: NormalizeAtmNodeRefOptions): {
    urn: string;
    nodeKind: AtmNodeKind;
    canonicalId: string;
    version: string | null;
};
export declare function isAtmUrn(value: unknown): boolean;
export declare function parseLegacyUri(value: unknown): {
    uri: string;
    scheme: string;
    repositoryAlias: string;
    relativePath: string;
    fragment: string;
    lineStart: number | null;
    lineEnd: number | null;
};
export declare function isLegacyUri(value: unknown): boolean;
export {};
