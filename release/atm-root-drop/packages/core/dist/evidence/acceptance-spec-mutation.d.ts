export declare const ACCEPTANCE_SPEC_MUTATION_SCHEMA_ID: "atm.acceptanceSpecMutation.v1";
export type AcceptanceMutationStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface AcceptanceAuthority {
    readonly specId: string;
    readonly specDigest: string;
    readonly sealed: boolean;
}
export interface AcceptanceMutation {
    readonly mutationId: string;
    readonly operator: 'negate' | 'remove-step' | 'swap-outcome' | string;
    readonly scenarioId: string;
    readonly expected: 'killed' | 'survived';
    readonly observed?: 'killed' | 'survived' | string;
}
export interface AcceptanceMutationInput {
    readonly authority: AcceptanceAuthority;
    readonly mutationSetId: string;
    readonly mutations: readonly AcceptanceMutation[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface AcceptanceMutationResult {
    readonly schemaId: typeof ACCEPTANCE_SPEC_MUTATION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly mutationSetId: string;
    readonly authority: AcceptanceAuthority;
    readonly mutations: readonly AcceptanceMutation[];
    readonly survivingMutationIds: readonly string[];
    readonly status: AcceptanceMutationStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileAcceptanceSpecMutation(i: AcceptanceMutationInput): AcceptanceMutationResult;
export declare const createAcceptanceSpecMutation: typeof compileAcceptanceSpecMutation;
export declare function replayAcceptanceSpecMutation(r: AcceptanceMutationResult): AcceptanceMutationResult;
export declare function validateAcceptanceSpecMutation(r: AcceptanceMutationResult): {
    ok: boolean;
    diagnostics: string[];
};
