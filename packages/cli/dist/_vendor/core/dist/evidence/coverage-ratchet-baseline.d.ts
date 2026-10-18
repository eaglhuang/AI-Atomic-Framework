export declare const COVERAGE_RATCHET_BASELINE_SCHEMA_ID: "atm.coverageRatchetBaseline.v1";
export declare const COVERAGE_RATCHET_BASELINE_COMPILER_ID: "atm.coverageRatchetBaselineAdapter.v1";
export type CoverageRatchetStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type CoverageRatchetScope = 'changed' | 'impacted' | 'repository';
export interface CoverageRatchetAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface CoverageRatchetBaselineInput {
    readonly scope: CoverageRatchetScope;
    readonly ratio: number;
    readonly covered: number;
    readonly total: number;
    readonly digest: string;
}
export interface CoverageRatchetInput {
    readonly ratchetId: string;
    readonly generatedAt: string;
    readonly authority: CoverageRatchetAuthority;
    readonly baselines: readonly CoverageRatchetBaselineInput[];
    readonly minimumRatio: number;
    readonly observedAuthorityDigest: string;
}
export interface CoverageRatchetResult {
    readonly schemaId: typeof COVERAGE_RATCHET_BASELINE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly compilerId: typeof COVERAGE_RATCHET_BASELINE_COMPILER_ID;
    readonly ratchetId: string;
    readonly generatedAt: string;
    readonly authority: CoverageRatchetAuthority;
    readonly minimumRatio: number;
    readonly baselines: readonly CoverageRatchetBaselineInput[];
    readonly projection: {
        readonly changed: CoverageRatchetBaselineInput | null;
        readonly impacted: CoverageRatchetBaselineInput | null;
        readonly repository: CoverageRatchetBaselineInput | null;
        readonly minimumObservedRatio: number;
    };
    readonly status: CoverageRatchetStatus;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export interface CoverageRatchetValidation {
    readonly ok: boolean;
    readonly diagnostics: readonly string[];
}
export declare function compileCoverageRatchetBaseline(input: CoverageRatchetInput): CoverageRatchetResult;
export declare const createCoverageRatchetBaseline: typeof compileCoverageRatchetBaseline;
export declare const migrateCoverageRatchetBaseline: typeof compileCoverageRatchetBaseline;
export declare function replayCoverageRatchetBaseline(result: CoverageRatchetResult): CoverageRatchetResult;
export declare function validateCoverageRatchetBaseline(result: CoverageRatchetResult): CoverageRatchetValidation;
