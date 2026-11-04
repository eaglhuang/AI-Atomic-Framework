export declare const LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID: "atm.legalRecoveryCheckpointsResult.v1";
export type RecoveryPhase = 'check-in' | 'close' | 'phase' | 'release';
export interface RecoveryAuthority {
    readonly authorityId: string;
    readonly sealed: boolean;
    readonly digest: string;
    readonly epoch?: string | null;
}
export interface RecoveryCheckpoint {
    readonly checkpointId: string;
    readonly phase: RecoveryPhase | string;
    readonly state: string;
    readonly predecessorIds?: readonly string[];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface RecoveryInput {
    readonly runId: string;
    readonly authority: RecoveryAuthority;
    readonly checkpoints: readonly RecoveryCheckpoint[];
}
export interface RecoveryDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly ref: string | null;
    readonly repairCommand: string | null;
}
export interface RecoveryProjection {
    readonly projectionId: string;
    readonly checkpointId: string;
    readonly phase: RecoveryPhase;
    readonly canonicalState: string;
    readonly predecessorIds: readonly string[];
    readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}
export interface RecoveryResult {
    readonly schemaId: typeof LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly resultId: string;
    readonly authority: RecoveryAuthority;
    readonly status: 'projected' | 'blocked' | 'stale' | 'contradictory';
    readonly projections: readonly RecoveryProjection[];
    readonly diagnostics: readonly RecoveryDiagnostic[];
    readonly provenance: {
        readonly inputDigest: string;
        readonly checkpointCount: number;
        readonly phases: readonly RecoveryPhase[];
    };
}
export declare function projectLegalRecoveryCheckpoints(input: RecoveryInput): RecoveryResult;
export declare const createLegalRecoveryCheckpoints: typeof projectLegalRecoveryCheckpoints;
export declare function replayLegalRecoveryCheckpoints(input: RecoveryInput, expected: RecoveryResult): {
    deterministic: boolean;
    result: RecoveryResult;
};
export declare function validateLegalRecoveryCheckpoints(result: RecoveryResult): {
    ok: boolean;
    diagnostics: RecoveryDiagnostic[];
};
