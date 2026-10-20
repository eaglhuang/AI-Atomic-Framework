export declare const STRUCTURAL_COVERAGE_SCHEMA_ID: "atm.structuralCoverage.v1";
export declare const STRUCTURAL_COVERAGE_COMPILER_ID: "atm.structuralCoverageAdapter.v1";
export type StructuralCoverageStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface StructuralCoverageModelRef {
    readonly modelId: string;
    readonly modelDigest: string;
}
export interface StructuralCoverageObligationInput {
    readonly obligationId: string;
    readonly semanticFamily: string;
    readonly sourceRef: string;
    readonly coverage: 'covered' | 'uncovered' | 'unsupported' | 'excluded';
    readonly observedDigest: string;
}
export interface StructuralCoverageDenominatorInput {
    readonly sourceId: string;
    readonly total: number;
    readonly digest: string;
}
export interface StructuralCoverageInput {
    readonly coverageId: string;
    readonly generatedAt: string;
    readonly model: StructuralCoverageModelRef;
    readonly denominator: StructuralCoverageDenominatorInput;
    readonly obligations: readonly StructuralCoverageObligationInput[];
}
export interface StructuralCoverageEntry extends StructuralCoverageObligationInput {
    readonly entryDigest: string;
}
export interface StructuralCoverageResult {
    readonly schemaId: typeof STRUCTURAL_COVERAGE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly compilerId: typeof STRUCTURAL_COVERAGE_COMPILER_ID;
    readonly coverageId: string;
    readonly generatedAt: string;
    readonly model: StructuralCoverageModelRef;
    readonly authority: {
        readonly sealed: true;
        readonly digest: string;
    };
    readonly denominator: StructuralCoverageDenominatorInput;
    readonly projection: {
        readonly total: number;
        readonly covered: number;
        readonly uncovered: number;
        readonly unsupported: number;
        readonly excluded: number;
        readonly ratio: number;
    };
    readonly entries: readonly StructuralCoverageEntry[];
    readonly status: StructuralCoverageStatus;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export interface StructuralCoverageValidation {
    readonly ok: boolean;
    readonly diagnostics: readonly string[];
}
export declare function compileStructuralCoverage(input: StructuralCoverageInput): StructuralCoverageResult;
export declare const createStructuralCoverage: typeof compileStructuralCoverage;
export declare function reconcileStructuralCoverageDenominator(input: StructuralCoverageInput): StructuralCoverageResult;
export declare function replayStructuralCoverage(result: StructuralCoverageResult): StructuralCoverageResult;
export declare function validateStructuralCoverage(result: StructuralCoverageResult): StructuralCoverageValidation;
