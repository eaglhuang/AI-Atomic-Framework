export declare const CAUSAL_NEIGHBORHOOD_SCHEMA_ID: "atm.causalNeighborhoodResult.v1";
export interface CausalInput {
    readonly runId: string;
    readonly authority: {
        readonly authorityId: string;
        readonly sealed: boolean;
        readonly digest: string;
    };
    readonly fingerprint: string;
    readonly publicSeam: string;
    readonly impactEdges: readonly string[];
    readonly validatorRefs: readonly string[];
    readonly changedFiles: readonly string[];
    readonly factors: readonly string[];
    readonly maxCombinations: number;
    readonly excludedFactors?: Readonly<Record<string, string>>;
}
export interface CausalResult {
    readonly schemaId: typeof CAUSAL_NEIGHBORHOOD_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly resultId: string;
    readonly status: 'compiled' | 'blocked' | 'stale';
    readonly authority: CausalInput['authority'];
    readonly neighborhood: readonly string[];
    readonly combinations: readonly (readonly string[])[];
    readonly exclusions: Readonly<Record<string, string>>;
    readonly diagnostics: readonly {
        readonly code: string;
        readonly message: string;
        readonly repairCommand: string | null;
    }[];
    readonly provenance: {
        readonly inputDigest: string;
        readonly combinationCount: number;
    };
}
export declare function compileCausalNeighborhood(input: CausalInput): CausalResult;
export declare const createCausalNeighborhood: typeof compileCausalNeighborhood;
export declare const generateFactorCombinations: typeof compileCausalNeighborhood;
export declare function replayCausalNeighborhood(input: CausalInput, expected: CausalResult): {
    deterministic: boolean;
    result: CausalResult;
};
export declare function validateCausalNeighborhood(result: CausalResult): {
    ok: boolean;
    diagnostics: any[];
};
