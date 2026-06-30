export declare const ReplacementMode: Readonly<{
    Draft: "draft";
    Shadow: "shadow";
    Canary: "canary";
    Active: "active";
    LegacyRetired: "legacy-retired";
}>;
type ReplacementModeValue = typeof ReplacementMode[keyof typeof ReplacementMode];
interface ReplacementLaneEvidenceInput {
    readonly evidenceRefs?: unknown;
    readonly reason?: unknown;
}
interface ReplacementLaneOptions {
    readonly repositoryRoot?: string;
    readonly now?: unknown;
    readonly actor?: unknown;
}
export declare function transitionReplacementMode(mapId: string, to: string, evidence?: ReplacementLaneEvidenceInput, options?: ReplacementLaneOptions): {
    ok: boolean;
    mapId: string;
    from: ReplacementModeValue;
    to: ReplacementModeValue;
    registryStatus: import("../index.ts").RegistryEntryStatus;
    reason: string;
    evidenceRefs: string[];
    actor: string;
    timestamp: string;
    specPath: string;
    registryPath: string;
    lineageLogPath: any;
    transitionRecord: {
        from: ReplacementModeValue;
        to: ReplacementModeValue;
        reason: string;
        evidenceRefs: string[];
        actor: string;
        timestamp: string;
    };
    mapSpec: any;
    registryEntry: import("../index.ts").MapRegistryEntryRecord;
    lineageLog: {
        canonicalMapId: string;
        generatedAt: string;
        transitions: unknown[];
        schemaId: string;
        mapId?: string;
        passed?: boolean;
        targetKind?: string;
        verificationStatus?: string;
        status?: string;
        reportId?: string;
        decision?: string;
        advisoryUnavailable?: boolean;
        target?: {
            readonly kind?: string;
            readonly id?: string | null;
        } | null;
        queueRecord?: {
            readonly status?: string;
            readonly proposal?: {
                readonly target?: {
                    readonly mapId?: string | null;
                } | null;
            } | null;
        } | null;
        proposal?: {
            readonly target?: {
                readonly mapId?: string | null;
            } | null;
        } | null;
        specVersion: string;
    };
};
export {};
