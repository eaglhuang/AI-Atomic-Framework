export declare const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = "atm.unifiedPatchApplication.v1";
export declare class UnifiedPatchApplicationError extends Error {
    readonly code = "ATM_UNIFIED_PATCH_CONTEXT_MISMATCH";
    constructor(message: string);
}
export interface UnifiedPatchHunk {
    readonly oldStart: number;
    readonly lines: readonly string[];
}
/** Parse the hunks of a unified diff; shared with the steward base composer. */
export declare function parseUnifiedPatchHunks(patchText: string): readonly UnifiedPatchHunk[];
/**
 * Apply a unified diff to `before`, returning the exact resulting text.
 *
 * Throws {@link UnifiedPatchApplicationError} when a hunk's context or removed
 * lines do not match the source at the position the hunk declares. Callers must
 * surface that as a blocked apply; they must not fall back to any other write.
 */
export declare function applyUnifiedPatch(before: string, patchText: string): string;
