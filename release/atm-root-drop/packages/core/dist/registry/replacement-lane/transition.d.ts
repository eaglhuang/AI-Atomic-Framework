import type { ReplacementLaneEvidenceInput, ReplacementLaneOptions } from './types.ts';
export declare function transitionReplacementMode(mapId: string, to: string, evidence?: ReplacementLaneEvidenceInput, options?: ReplacementLaneOptions): {
    ok: boolean;
    mapId: string;
    from: import("./types.ts").ReplacementModeValue;
    to: import("./types.ts").ReplacementModeValue;
    registryStatus: import("../../index.ts").RegistryEntryStatus;
    reason: string;
    evidenceRefs: string[];
    actor: string;
    timestamp: string;
    specPath: string;
    registryPath: string;
    lineageLogPath: any;
    transitionRecord: {
        from: import("./types.ts").ReplacementModeValue;
        to: import("./types.ts").ReplacementModeValue;
        reason: string;
        evidenceRefs: string[];
        actor: string;
        timestamp: string;
    };
    mapSpec: any;
    registryEntry: import("../../index.ts").MapRegistryEntryRecord;
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
