export declare const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = "atm.unifiedPatchApplication.v1";
export declare const NO_NEWLINE_AT_EOF_MARKER = "\\ No newline at end of file";
export declare class UnifiedPatchApplicationError extends Error {
    readonly code = "ATM_UNIFIED_PATCH_CONTEXT_MISMATCH";
    constructor(message: string);
}
export interface UnifiedPatchHunkLine {
    readonly marker: ' ' | '-' | '+';
    readonly text: string;
    readonly noNewline: boolean;
}
export interface UnifiedPatchHunk {
    readonly oldStart: number;
    readonly lines: readonly UnifiedPatchHunkLine[];
}
/** How a patch treats the final newline relative to the base file. */
export type EofNewlineDecision = 'preserve' | 'present' | 'absent';
export interface SourceTextLines {
    readonly lineEnding: '\n' | '\r\n';
    readonly endsWithNewline: boolean;
    readonly lines: string[];
}
/** Old-file line index of a hunk. Unified diffs use 0 only for an empty preimage. */
export declare function hunkOldLineIndex(oldStart: number): number;
/** Parse the hunks of a unified diff; shared with the steward base composer. */
export declare function parseUnifiedPatchHunks(patchText: string): readonly UnifiedPatchHunk[];
export declare function splitSourceText(before: string): SourceTextLines;
export declare function joinSourceText(lines: readonly string[], lineEnding: string, endsWithNewline: boolean): string;
/** True when the patch line's newline flag matches the source line git would require. */
export declare function oldSideNewlineAgrees(input: {
    readonly noNewline: boolean;
    readonly lineIndex: number;
    readonly lineCount: number;
    readonly fileEndsWithNewline: boolean;
}): boolean;
/**
 * Reject a marker that is not on the final line of its side. Git only emits
 * `\ No newline at end of file` for the last line of the old or new file.
 */
export declare function eofMarkerViolation(hunks: readonly UnifiedPatchHunk[], baseLineCount: number): string | null;
/** Final-newline decision for hunks already known to apply to a base of `baseLineCount` lines. */
export declare function eofNewlineDecision(hunks: readonly UnifiedPatchHunk[], baseLineCount: number): EofNewlineDecision;
export declare function resolveEofNewline(decision: EofNewlineDecision, fileEndsWithNewline: boolean): boolean;
/**
 * Apply a unified diff to `before`, returning the exact resulting text.
 *
 * Throws {@link UnifiedPatchApplicationError} when a hunk's context or removed
 * lines do not match the source at the position the hunk declares. Callers must
 * surface that as a blocked apply; they must not fall back to any other write.
 */
export declare function applyUnifiedPatch(before: string, patchText: string): string;
