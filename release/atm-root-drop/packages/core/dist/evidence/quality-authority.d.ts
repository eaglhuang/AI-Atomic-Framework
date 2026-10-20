export declare const QUALITY_AUTHORITY_SCHEMA_ID: "atm.qualityAuthority.v1";
export type QualityAuthorityStatus = 'proven' | 'stale' | 'blocked' | 'contradictory';
export interface QualityAuthorityInput {
    readonly authorityId: string;
    readonly policyEpoch: string;
    readonly expectedPolicyEpoch: string;
    readonly policyDigest: string;
    readonly oracleDigest: string;
    readonly denominatorDigest: string;
    readonly verdictDigest: string;
    readonly protectedSurfaces: readonly string[];
    readonly observedProtectedSurfaces: readonly string[];
    readonly roleCapabilities: Readonly<Record<string, readonly string[]>>;
    readonly writerRole: string;
}
export interface QualityAuthorityResult {
    readonly schemaId: typeof QUALITY_AUTHORITY_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly authorityId: string;
    readonly policyEpoch: string;
    readonly authority: {
        readonly policyDigest: string;
        readonly oracleDigest: string;
        readonly denominatorDigest: string;
        readonly verdictDigest: string;
        readonly sealed: true;
    };
    readonly protectedSurfaces: readonly string[];
    readonly roleCapabilities: Readonly<Record<string, readonly string[]>>;
    readonly status: QualityAuthorityStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly authorityDigest: string;
}
export declare function compileQualityAuthority(input: QualityAuthorityInput): QualityAuthorityResult;
export declare const createQualityAuthority: typeof compileQualityAuthority;
export declare function validateQualityAuthority(r: QualityAuthorityResult): {
    ok: boolean;
    diagnostics: string[];
};
