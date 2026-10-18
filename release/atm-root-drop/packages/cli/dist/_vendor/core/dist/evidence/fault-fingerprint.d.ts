export declare const FAULT_FINGERPRINT_SCHEMA_ID: "atm.faultFingerprintResult.v1";
export type FaultFamily = 'shared-index' | 'sealed-commit' | 'cas-queue' | 'foreign-dirty' | 'stale-batch' | 'close-deferral' | 'unknown';
export interface FaultObservation {
    readonly observationId: string;
    readonly publicSeam: string;
    readonly errorClass: string;
    readonly causalImpact: string;
    readonly mutationLineage?: string | null;
    readonly familyHint?: string | null;
    readonly mutationEvidence?: readonly string[];
}
export interface FaultAuthority {
    readonly authorityId: string;
    readonly sealed: boolean;
    readonly digest: string;
}
export interface FaultFingerprintInput {
    readonly runId: string;
    readonly authority: FaultAuthority;
    readonly observations: readonly FaultObservation[];
    readonly knownFamilies?: readonly FaultFamily[];
}
export interface FaultDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly ref: string | null;
    readonly repairCommand: string | null;
}
export interface FaultFamilyMatch {
    readonly family: FaultFamily;
    readonly confidence: number;
    readonly decision: 'exact-match' | 'new-family-proposal' | 'mapping-review';
    readonly evidence: readonly string[];
}
export interface FaultFingerprint {
    readonly fingerprintId: string;
    readonly observationId: string;
    readonly normalized: {
        readonly publicSeam: string;
        readonly errorClass: string;
        readonly causalImpact: string;
        readonly mutationLineage: string | null;
    };
    readonly familyMatch: FaultFamilyMatch;
}
export interface FaultFingerprintResult {
    readonly schemaId: typeof FAULT_FINGERPRINT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly resultId: string;
    readonly authority: FaultAuthority;
    readonly status: 'matched' | 'blocked' | 'stale';
    readonly fingerprints: readonly FaultFingerprint[];
    readonly diagnostics: readonly FaultDiagnostic[];
    readonly provenance: {
        readonly inputDigest: string;
        readonly observationCount: number;
        readonly knownFamilies: readonly FaultFamily[];
    };
}
export declare function createFaultFingerprint(input: FaultFingerprintInput): FaultFingerprintResult;
export declare const fingerprintFault: typeof createFaultFingerprint;
export declare function matchSemanticFamily(input: FaultFingerprintInput): FaultFingerprintResult;
export declare function replayFaultFingerprint(input: FaultFingerprintInput, expected: FaultFingerprintResult): {
    deterministic: boolean;
    result: FaultFingerprintResult;
};
export declare function validateFaultFingerprint(result: FaultFingerprintResult): {
    ok: boolean;
    diagnostics: FaultDiagnostic[];
};
