export declare const SHADOW_COMPARISON_SCHEMA_ID: "atm.shadowComparison.v1";
export type ShadowOutcome = 'pass' | 'fail' | 'unknown';
export type ShadowStatus = 'proven' | 'blocked';
export interface ShadowCase {
    readonly caseId: string;
    readonly selected: boolean;
    readonly legacy: ShadowOutcome;
    readonly selectedResult: ShadowOutcome;
    readonly latencyMs: number;
    readonly cached?: boolean;
}
export interface ShadowCandidateIdentity {
    readonly sourceDigest: string;
    readonly runnerDigest: string;
    readonly catalogDigest: string;
    readonly candidateDigest: string;
}
export interface ShadowCommandReceipt {
    readonly command: string;
    readonly runId: string;
    readonly artifactPath?: string | null;
    readonly stale?: boolean;
}
export interface ShadowComparisonInput {
    readonly authorityDigest: string;
    readonly policyEpoch: string;
    readonly selectedCandidate: ShadowCandidateIdentity;
    readonly fullCandidate: ShadowCandidateIdentity;
    readonly cases?: readonly ShadowCase[];
    readonly legacyLatencyMs?: number;
    readonly selectedCommand?: ShadowCommandReceipt | null;
    readonly fullCommand?: ShadowCommandReceipt | null;
}
export interface ShadowComparisonResult {
    readonly schemaId: typeof SHADOW_COMPARISON_SCHEMA_ID;
    readonly status: ShadowStatus;
    readonly policyEpoch: string;
    readonly policyEpochValid: boolean;
    readonly candidate: {
        readonly sourceDigest: string;
        readonly runnerDigest: string;
        readonly catalogDigest: string;
        readonly candidateDigest: string;
        readonly sameCandidate: boolean;
    };
    readonly commands: {
        readonly selected: ShadowCommandReceipt | null;
        readonly full: ShadowCommandReceipt | null;
    };
    readonly selected: readonly string[];
    readonly skipped: readonly string[];
    readonly falseBlocks: readonly string[];
    readonly escapedDefects: readonly string[];
    readonly unknown: readonly string[];
    readonly latency: {
        readonly selectedMs: number;
        readonly legacyMs: number;
    };
    readonly cache: {
        readonly hits: number;
        readonly misses: number;
        readonly invalidated: boolean;
    };
    readonly legacyAuthority: readonly {
        readonly caseId: string;
        readonly result: string;
    }[];
    readonly diagnostics: readonly string[];
    readonly negativeControls: readonly string[];
    readonly resultDigest: string;
}
export declare function compareShadow(input: ShadowComparisonInput): ShadowComparisonResult;
export declare const compileShadowComparison: typeof compareShadow;
export declare function validateShadowComparison(result: ShadowComparisonResult): {
    readonly ok: boolean;
    readonly diagnostics: readonly string[];
};
