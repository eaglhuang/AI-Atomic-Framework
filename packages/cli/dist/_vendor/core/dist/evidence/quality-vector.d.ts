export declare const QUALITY_VECTOR_SCHEMA_ID: "atm.qualityVector.v1";
export interface QualityVectorInput {
    readonly authorityDigest: string;
    readonly dimensions: Readonly<Record<string, number>>;
    readonly blockers?: readonly string[];
    readonly nonClaims?: readonly string[];
}
export declare function compileQualityVector(input: QualityVectorInput): {
    resultDigest: string;
    schemaId: "atm.qualityVector.v1";
    specVersion: "0.1.0";
    authorityDigest: string;
    dimensions: {
        [k: string]: number;
    };
    blockers: string[];
    nonClaims: string[];
    status: string;
    diagnostics: string[];
    repairCommand: string | null;
};
export declare function validateQualityVector(r: ReturnType<typeof compileQualityVector>): {
    ok: boolean;
    diagnostics: string[];
};
