export declare function normalizeVersionLineage(lineageLog: Record<string, unknown> | null | undefined, options: {
    atomId: string;
    mapId: string;
    fromVersion: string;
    toVersion: string;
    sourceRef: string;
    timestamp: string;
}): {
    ok: false;
    issues: string[];
    lineage?: undefined;
} | {
    ok: true;
    lineage: {
        currentVersion: string;
        versions: {
            version: string;
            specHash: string;
            codeHash: string;
            testHash: string;
            timestamp: string;
            semanticFingerprint?: string | null;
        }[];
        sourceRef: string;
        advisory: string;
        updatedAt: string;
    };
    issues?: undefined;
};
export declare function lineageLogMatchesMap(lineageLog: Record<string, unknown> | null | undefined, mapId: string): boolean;
export declare function resolveBackfillTimestamp(optionAt: unknown, lineageLog: Record<string, unknown> | null | undefined, atomId: string): string;
