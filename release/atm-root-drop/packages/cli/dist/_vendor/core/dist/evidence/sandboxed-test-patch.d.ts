export declare const SANDBOXED_TEST_PATCH_SCHEMA_ID: "atm.sandboxedTestPatch.v1";
export type SandboxedTestPatchStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface PatchAuthority {
    readonly authorityId: string;
    readonly baseDigest: string;
    readonly sealed: boolean;
}
export interface TestPatchOperation {
    readonly operationId: string;
    readonly path: string;
    readonly start: number;
    readonly end: number;
    readonly replacement: string;
}
export interface SandboxPatchInput {
    readonly authority: PatchAuthority;
    readonly patchId: string;
    readonly operations: readonly TestPatchOperation[];
    readonly requiredTestIds: readonly string[];
    readonly passingTestIds: readonly string[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface SandboxPatchResult {
    readonly schemaId: typeof SANDBOXED_TEST_PATCH_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly patchId: string;
    readonly authority: PatchAuthority;
    /** Observed digest of the exact source tree against which this patch was evaluated. */
    readonly sourceDigest: string;
    readonly operations: readonly TestPatchOperation[];
    readonly minimizedOperationIds: readonly string[];
    readonly requiredTestIds: readonly string[];
    readonly passingTestIds: readonly string[];
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly status: SandboxedTestPatchStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly resultDigest: string;
}
export declare function compileSandboxedTestPatch(input: SandboxPatchInput): SandboxPatchResult;
export declare const createSandboxedTestPatch: typeof compileSandboxedTestPatch;
export declare function replaySandboxedTestPatch(result: SandboxPatchResult): SandboxPatchResult;
export declare function validateSandboxedTestPatch(result: SandboxPatchResult): {
    ok: boolean;
    diagnostics: string[];
};
