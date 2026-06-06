export declare class AtmUrnError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function inferAtmNodeKind(canonicalId: any): "atom" | "map" | "police" | "behavior";
export declare function formatAtmUrn(input: any): string;
export declare function parseAtmUrn(value: any): {
    urn: string;
    nodeKind: string;
    canonicalId: string;
    version: string | null;
};
export declare function normalizeAtmNodeRef(value: any, options?: any): {
    urn: string;
    nodeKind: string;
    canonicalId: string;
    version: string | null;
};
export declare function isAtmUrn(value: any): boolean;
export declare function parseLegacyUri(value: any): {
    uri: string;
    scheme: string;
    repositoryAlias: string;
    relativePath: string;
    fragment: string;
    lineStart: number | null;
    lineEnd: number | null;
};
export declare function isLegacyUri(value: any): boolean;
