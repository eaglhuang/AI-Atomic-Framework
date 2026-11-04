export declare const EXAMPLE_BRANCH_GENERATORS_SCHEMA_ID: "atm.exampleBranchGenerators.v1";
export type ExampleBranchGeneratorStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface GeneratorAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: boolean;
}
export interface ExampleBranchInput {
    readonly branchId: string;
    readonly predicate: string;
    readonly outcome: 'covered' | 'uncovered' | 'unsupported';
    readonly survivorIds?: readonly string[];
}
export interface ExampleBranchGeneratorInput {
    readonly authority: GeneratorAuthority;
    readonly generatorId: string;
    readonly branches: readonly ExampleBranchInput[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface GeneratedExample {
    readonly exampleId: string;
    readonly branchId: string;
    readonly predicate: string;
    readonly outcome: ExampleBranchInput['outcome'];
    readonly survivorIds: readonly string[];
    readonly digest: string;
}
export interface ExampleBranchGeneratorResult {
    readonly schemaId: typeof EXAMPLE_BRANCH_GENERATORS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly generatorId: string;
    readonly authority: GeneratorAuthority;
    readonly sourceDigest: string;
    readonly examples: readonly GeneratedExample[];
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly status: ExampleBranchGeneratorStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly resultDigest: string;
}
export declare function compileExampleBranchGenerators(input: ExampleBranchGeneratorInput): ExampleBranchGeneratorResult;
export declare const createExampleBranchGenerators: typeof compileExampleBranchGenerators;
export declare function replayExampleBranchGenerators(result: ExampleBranchGeneratorResult): ExampleBranchGeneratorResult;
export declare function validateExampleBranchGenerators(result: ExampleBranchGeneratorResult): {
    ok: boolean;
    diagnostics: string[];
};
