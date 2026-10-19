export declare const SECURITY_QUALITY_RECEIPTS_SCHEMA_ID: "atm.securityQualityReceipts.v1";
export type SecurityQualityStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface SecurityAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface SecurityFinding {
    readonly findingId: string;
    readonly surface: string;
    readonly severity: 'low' | 'medium' | 'high' | 'critical';
    readonly status: 'pass' | 'risk-accepted' | 'fail';
    readonly digest: string;
}
export interface RiskAcceptance {
    readonly findingId: string;
    readonly rationale: string;
    readonly authorityDigest: string;
    readonly approved: true;
}
export interface SecurityQualityInput {
    readonly runId: string;
    readonly generatedAt: string;
    readonly authority: SecurityAuthority;
    readonly observedAuthorityDigest: string;
    readonly findings: readonly SecurityFinding[];
    readonly riskAcceptances?: readonly RiskAcceptance[];
    readonly requiredSurfaces?: readonly string[];
    readonly supportedSeverities?: readonly string[];
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface SecurityQualityResult {
    readonly schemaId: typeof SECURITY_QUALITY_RECEIPTS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly generatedAt: string;
    readonly authority: SecurityAuthority;
    readonly findings: readonly SecurityFinding[];
    readonly riskAcceptances: readonly RiskAcceptance[];
    readonly projection: {
        readonly findingCount: number;
        readonly failed: readonly string[];
        readonly accepted: readonly string[];
        readonly requiredSurfaces: readonly string[];
        readonly missingSurfaces: readonly string[];
    };
    readonly status: SecurityQualityStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileSecurityQualityReceipts(input: SecurityQualityInput): SecurityQualityResult;
export declare const createSecurityQualityReceipts: typeof compileSecurityQualityReceipts;
export declare function replaySecurityQualityReceipts(receipt: SecurityQualityResult): SecurityQualityResult;
export declare function validateSecurityQualityReceipts(receipt: SecurityQualityResult): {
    ok: boolean;
    diagnostics: string[];
};
