export declare const EVIDENCE_FRESHNESS_CERTIFICATE_SCHEMA_ID: "atm.evidenceFreshnessCertificate.v1";
export type EvidenceFreshnessStatus = 'proven' | 'stale' | 'blocked' | 'contradictory';
export interface SealedObservation {
    readonly observationId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface EvidenceFreshnessInput {
    readonly certificateId: string;
    readonly authorityDigest: string;
    readonly expectedWatermark: string;
    readonly expectedCacheDigest: string;
    readonly expectedResumeCursor: string;
    readonly observedWatermark: string;
    readonly observedCacheDigest: string;
    readonly observedResumeCursor: string;
    readonly observations: readonly SealedObservation[];
    readonly knownObservationIds?: readonly string[];
}
export interface EvidenceFreshnessResult {
    readonly schemaId: typeof EVIDENCE_FRESHNESS_CERTIFICATE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly certificateId: string;
    readonly authorityDigest: string;
    readonly freshness: {
        readonly watermark: string;
        readonly cacheDigest: string;
        readonly resumeCursor: string;
    };
    readonly acceptedObservationIds: readonly string[];
    readonly duplicateObservationIds: readonly string[];
    readonly status: EvidenceFreshnessStatus;
    readonly diagnostics: readonly string[];
    readonly invalidation: {
        readonly code: string;
        readonly repairCommand: string;
    } | null;
    readonly certificateDigest: string;
}
export declare function compileEvidenceFreshnessCertificate(input: EvidenceFreshnessInput): EvidenceFreshnessResult;
export declare const createEvidenceFreshnessCertificate: typeof compileEvidenceFreshnessCertificate;
export declare function replayEvidenceFreshnessCertificate(result: EvidenceFreshnessResult, input: Omit<EvidenceFreshnessInput, 'observedWatermark' | 'observedCacheDigest' | 'observedResumeCursor'> & {
    readonly observedWatermark: string;
    readonly observedCacheDigest: string;
    readonly observedResumeCursor: string;
}): EvidenceFreshnessResult;
export declare function validateEvidenceFreshnessCertificate(result: EvidenceFreshnessResult): {
    ok: boolean;
    diagnostics: string[];
};
