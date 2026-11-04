import { type ObligationInventory, type ObligationSourceRef, type ObligationValidatorRef } from './obligation-inventory.js';
export declare const COVERAGE_UNIVERSE_SCHEMA_ID: "atm.coverageUniverse.v1";
export declare const COVERAGE_UNIVERSE_COMPILER_ID: "atm.coverageUniverseCompiler.v1";
export type CoverageReachabilityStatus = 'reachable' | 'unreachable' | 'unsupported' | 'excluded' | 'unknown';
export interface CoverageUniverseModelInput {
    readonly modelId: string;
    readonly modelVersion?: string | null;
    readonly modelDigest?: string | null;
}
export interface CoverageUniverseObligationInput {
    readonly semanticKey: string;
    readonly semanticFamily: string;
    readonly owningSeam: string;
    readonly reachabilityStatus: CoverageReachabilityStatus;
    readonly sourceRefs?: readonly ObligationSourceRef[];
    readonly validatorRefs?: readonly ObligationValidatorRef[];
    readonly description?: string | null;
    readonly observedAt?: string | null;
    readonly exclusionReason?: string | null;
}
export interface CoverageUniverseCompileInput {
    readonly universeId: string;
    readonly generatedAt: string;
    readonly model: CoverageUniverseModelInput;
    readonly obligations: readonly CoverageUniverseObligationInput[];
}
export interface CoverageUniverseEntry {
    readonly obligationId: string;
    readonly semanticKey: string;
    readonly semanticFamily: string;
    readonly owningSeam: string;
    readonly reachabilityStatus: CoverageReachabilityStatus;
    readonly sourceRefs: readonly ObligationSourceRef[];
    readonly validatorRefs: readonly ObligationValidatorRef[];
    readonly description: string | null;
    readonly exclusionReason: string | null;
    readonly inventoryEntryDigest: string;
    readonly gapKind: 'none' | 'gap' | 'unsupported' | 'excluded' | 'unknown';
}
export interface CoverageUniverseGapCandidate {
    readonly obligationId: string;
    readonly semanticFamily: string;
    readonly owningSeam: string;
    readonly reachabilityStatus: CoverageReachabilityStatus;
    readonly reason: string;
    readonly candidateTestCaseId: string;
}
export interface CoverageUniverse {
    readonly schemaId: typeof COVERAGE_UNIVERSE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly compilerId: typeof COVERAGE_UNIVERSE_COMPILER_ID;
    readonly universeId: string;
    readonly generatedAt: string;
    readonly model: Required<CoverageUniverseModelInput>;
    readonly entries: readonly CoverageUniverseEntry[];
    readonly obligationInventory: ObligationInventory;
    readonly gapCandidates: readonly CoverageUniverseGapCandidate[];
    readonly reachabilitySummary: Record<CoverageReachabilityStatus, number>;
    readonly universeDigest: string;
}
export declare class CoverageUniverseCompiler {
    compile(input: CoverageUniverseCompileInput): CoverageUniverse;
}
export declare function compileCoverageUniverse(input: CoverageUniverseCompileInput): CoverageUniverse;
