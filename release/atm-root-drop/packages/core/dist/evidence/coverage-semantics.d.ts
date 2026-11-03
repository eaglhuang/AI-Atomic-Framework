export declare const QUALITY_CERTIFICATE_SCHEMA_ID: "atm.qualityCertificate.v1";
export type CoverageClaimKind = 'finite-model-proven' | 'sufficient-under-assumptions' | 'blocked-counterexample' | 'indeterminate' | 'unsupported' | 'stale';
export type CoverageObligationStatus = 'proven' | 'sufficient-under-assumptions' | 'blocked' | 'unknown' | 'unsupported' | 'stale' | 'excluded';
export interface CoverageModelRef {
    readonly modelId: string;
    readonly version?: string | null;
    readonly digest?: string | null;
    readonly description?: string | null;
}
export interface CoverageAssumption {
    readonly id: string;
    readonly statement: string;
}
export interface CoverageExclusion {
    readonly id: string;
    readonly reason: string;
}
export interface CoverageObligationSummary {
    readonly status: CoverageObligationStatus;
    readonly count: number;
}
export interface QualityCertificateInput {
    readonly certificateId: string;
    readonly issuedAt: string;
    readonly model: CoverageModelRef;
    readonly claimKind: CoverageClaimKind;
    readonly coverageRatio: number;
    readonly assumptions?: readonly CoverageAssumption[];
    readonly exclusions?: readonly CoverageExclusion[];
    readonly obligationSummary: readonly CoverageObligationSummary[];
    readonly evidenceRefs?: readonly string[];
    readonly notes?: readonly string[];
}
export interface QualityCertificate extends QualityCertificateInput {
    readonly schemaId: typeof QUALITY_CERTIFICATE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly modelRelative: true;
}
export interface QualityCertificateDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly ref: string | null;
}
export interface QualityCertificateValidation {
    readonly ok: boolean;
    readonly diagnostics: readonly QualityCertificateDiagnostic[];
    readonly terminalStatus: CoverageClaimKind;
}
export interface QualityCertificateSummary {
    readonly certificateId: string;
    readonly modelId: string;
    readonly claimKind: CoverageClaimKind;
    readonly coverageRatio: number;
    readonly provenCount: number;
    readonly gapCount: number;
    readonly unsupportedCount: number;
    readonly assumptionCount: number;
    readonly exclusionCount: number;
    readonly modelRelative: true;
}
export declare function createQualityCertificate(input: QualityCertificateInput): QualityCertificate;
export declare function validateQualityCertificate(certificate: QualityCertificate): QualityCertificateValidation;
export declare function summarizeQualityCertificate(certificate: QualityCertificate): QualityCertificateSummary;
