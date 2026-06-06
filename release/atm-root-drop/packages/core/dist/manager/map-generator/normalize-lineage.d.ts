export declare function normalizeOptionalMemberRole(value: any): {
    role?: undefined;
} | {
    role: string;
};
export declare function normalizeOptionalEdgeKind(value: any): {
    edgeKind?: undefined;
} | {
    edgeKind: string;
};
export declare function normalizeReplacement(replacement: any): {
    legacyUris: string[];
    mode: string;
    evidenceRefs: string[];
} | null;
export declare function normalizeLegacyUris(values: any): string[];
export declare function normalizeReplacementMode(value: any): string;
export declare function normalizeEvidenceRefs(values: any): string[];
