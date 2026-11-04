import type { ReplacementLaneEvidenceInput, ReplacementLaneOptions } from './types.js';
export declare function transitionReplacementMode(mapId: string, to: string, evidence?: ReplacementLaneEvidenceInput, options?: ReplacementLaneOptions): {
    ok: boolean;
    mapId: string;
    from: import("./types.js").ReplacementModeValue;
    to: import("./types.js").ReplacementModeValue;
    registryStatus: import("../../index.js").RegistryEntryStatus;
    reason: string;
    evidenceRefs: string[];
    actor: string;
    timestamp: string;
    specPath: string;
    registryPath: string;
    lineageLogPath: any;
    transitionRecord: {
        from: import("./types.js").ReplacementModeValue;
        to: import("./types.js").ReplacementModeValue;
        reason: string;
        evidenceRefs: string[];
        actor: string;
        timestamp: string;
    };
    mapSpec: any;
    registryEntry: import("../../index.js").MapRegistryEntryRecord;
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
