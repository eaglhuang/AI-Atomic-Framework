export declare function normalizeOptionalMemberRole(value: unknown): {
    role?: undefined;
} | {
    role: string;
};
export declare function normalizeOptionalEdgeKind(value: unknown): {
    edgeKind?: undefined;
} | {
    edgeKind: string;
};
export declare function normalizeReplacement(replacement: unknown): {
    legacyUris: string[];
    mode: string;
    evidenceRefs: string[];
} | null;
export declare function normalizeLegacyUris(values: unknown): string[];
export declare function normalizeReplacementMode(value: unknown): string;
export declare function normalizeEvidenceRefs(values: unknown): string[];
