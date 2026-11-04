export declare const CONCURRENCY_FUZZ_GENERATORS_SCHEMA_ID: "atm.concurrencyFuzzGenerators.v1";
export type ConcurrencyFuzzStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export declare const CONCURRENCY_FUZZ_SUPPORTED_FAULTS: readonly ["none", "timeout", "drop", "reorder", "crash"];
export interface FuzzAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: boolean;
}
export interface FuzzScenario {
    readonly scenarioId: string;
    readonly schedule: readonly string[];
    readonly fault: 'none' | 'timeout' | 'drop' | 'reorder' | 'crash' | string;
    readonly expected: string;
}
export interface FuzzInput {
    readonly authority: FuzzAuthority;
    readonly generatorId: string;
    readonly scenarios: readonly FuzzScenario[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface FuzzResult {
    readonly schemaId: typeof CONCURRENCY_FUZZ_GENERATORS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly generatorId: string;
    readonly authority: FuzzAuthority;
    readonly scenarios: readonly FuzzScenario[];
    readonly seeds: readonly string[];
    readonly status: ConcurrencyFuzzStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileConcurrencyFuzzGenerators(i: FuzzInput): FuzzResult;
export declare const createConcurrencyFuzzGenerators: typeof compileConcurrencyFuzzGenerators;
export declare function replayConcurrencyFuzzGenerators(r: FuzzResult): FuzzResult;
export declare function validateConcurrencyFuzzGenerators(r: FuzzResult): {
    ok: boolean;
    diagnostics: string[];
};
