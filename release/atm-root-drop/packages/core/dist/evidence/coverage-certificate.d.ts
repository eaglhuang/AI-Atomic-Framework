export declare const COVERAGE_CERTIFICATE_SCHEMA_ID: "atm.coverageCertificate.v1";
export type CertificateStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface CoverageAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface CoverageObligation {
    readonly obligationId: string;
    readonly covered: boolean;
    readonly sourceDigest: string;
    readonly evidenceDigest?: string;
    readonly disposition?: 'closed' | 'open' | 'unknown';
}
export interface CoverageCertificateInput {
    readonly authority: CoverageAuthority;
    readonly certificateId: string;
    readonly obligations: readonly CoverageObligation[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface CoverageCertificateResult {
    readonly schemaId: typeof COVERAGE_CERTIFICATE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly certificateId: string;
    readonly authority: CoverageAuthority;
    readonly obligations: readonly CoverageObligation[];
    readonly covered: number;
    readonly total: number;
    readonly nonClaims: readonly string[];
    readonly status: CertificateStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileCoverageCertificate(input: CoverageCertificateInput): CoverageCertificateResult;
export declare const createCoverageCertificate: typeof compileCoverageCertificate;
export declare function replayCoverageCertificate(r: CoverageCertificateResult): CoverageCertificateResult;
export declare function validateCoverageCertificate(r: CoverageCertificateResult): {
    ok: boolean;
    diagnostics: string[];
};
