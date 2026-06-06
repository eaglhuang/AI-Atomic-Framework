export interface RetirementProofValidationResult {
    readonly ok: boolean;
    readonly issues: readonly string[];
}
export declare function validateRetirementProof(proof: any): RetirementProofValidationResult;
export declare function createRetirementProof(options: {
    readonly mapId: string;
    readonly verifiedAt: string;
    readonly verifiedBy: string;
    readonly mapVersion?: string;
    readonly retiredLegacyUris?: readonly string[];
    readonly callerRiskCleared: boolean;
    readonly entrypointRiskCleared: boolean;
    readonly unresolvedCallers?: readonly string[];
    readonly unresolvedEntrypoints?: readonly string[];
    readonly reviewAdvisoryRefs?: readonly string[];
    readonly notes?: string;
}): {
    failureReason?: string | undefined;
    verificationStatus: string;
    notes?: string | undefined;
    fromMode: string;
    toMode: string;
    verifiedAt: string;
    verifiedBy: string;
    retiredLegacyUris: string[];
    callerRiskCleared: boolean;
    entrypointRiskCleared: boolean;
    unresolvedCallers: string[];
    unresolvedEntrypoints: string[];
    reviewAdvisoryRefs: string[];
    mapVersion?: string | undefined;
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    proofId: string;
    mapId: string;
};
