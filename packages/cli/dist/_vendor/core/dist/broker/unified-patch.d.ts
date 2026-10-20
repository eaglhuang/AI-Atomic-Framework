export declare const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = "atm.unifiedPatchApplication.v1";
export declare const NO_NEWLINE_AT_EOF_MARKER = "\\ No newline at end of file";
/** Bounded outward search window, in lines either side of the declared start. */
export declare const HUNK_LOCATOR_WINDOW = 50;
export type UnifiedPatchErrorReason = 'malformed' | 'context-not-found' | 'context-ambiguous' | 'hunk-overlap' | 'out-of-range' | 'newline-mismatch' | 'eof-marker' | 'context-mismatch';
export declare class UnifiedPatchApplicationError extends Error {
    readonly code = "ATM_UNIFIED_PATCH_CONTEXT_MISMATCH";
    readonly reason: UnifiedPatchErrorReason;
    constructor(message: string, reason?: UnifiedPatchErrorReason);
}
export interface UnifiedPatchHunkLine {
    readonly marker: ' ' | '-' | '+';
    readonly text: string;
    readonly noNewline: boolean;
}
export interface UnifiedPatchHunk {
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly lines: readonly UnifiedPatchHunkLine[];
}
/** How a patch treats the final newline relative to the base file. */
export type EofNewlineDecision = 'preserve' | 'present' | 'absent';
/**
 * Lines split on LF only. A line keeps its own `\r`, so a CRLF line's text
 * ends in `\r` and an LF line's does not (`lineEol`). Untouched lines therefore
 * round-trip byte for byte, and context matching compares the CR the way
 * `git apply` does by default. `lineEnding` is informational only (CRLF when
 * any line ends in CRLF); joining never rewrites a line's terminator.
 */
export interface SourceTextLines {
    readonly lineEnding: '\n' | '\r\n';
    readonly endsWithNewline: boolean;
    readonly lines: string[];
}
/** Zero-count hunks insert after oldStart; other hunks start on oldStart. */
export declare function hunkOldLineIndex(oldStart: number, oldCount?: number): number;
/** Parse one file's unified diff, rejecting incomplete or overlong bodies. */
export declare function parseUnifiedPatch(patchText: string, options?: {
    targetFile?: string;
}): readonly UnifiedPatchHunk[];
export declare const parseUnifiedPatchHunks: typeof parseUnifiedPatch;
export interface LocatedHunk {
    readonly hunk: UnifiedPatchHunk;
    readonly declaredIndex: number;
    readonly index: number;
    readonly offset: number;
}
export type HunkLocateMode = 'nearest' | 'unique';
export declare function locateUnifiedPatchHunks(source: SourceTextLines, hunks: readonly UnifiedPatchHunk[], options?: {
    mode?: HunkLocateMode;
    window?: number;
}): LocatedHunk[];
export interface HunkOffset {
    declaredOldStart: number;
    appliedOldStart: number;
    offset: number;
}
export declare function hunkOffsetsOf(located: readonly LocatedHunk[]): HunkOffset[];
export declare function locatedLineIndexes(located: readonly LocatedHunk[]): {
    covered: number[];
    changed: number[];
};
export declare function splitSourceText(before: string): SourceTextLines;
/** The terminator a split line carries: CRLF when its text ends in CR. */
export declare function lineEol(line: string, isLast: boolean, endsWithNewline: boolean): '' | '\n' | '\r\n';
/**
 * Join lines split by `splitSourceText`. Each line already carries its own CR,
 * so the separator is always LF; `_lineEnding` is kept for call-site
 * compatibility and does not rewrite any line.
 */
export declare function joinSourceText(lines: readonly string[], _lineEnding: string, endsWithNewline: boolean): string;
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
export declare function eofMarkerViolation(hunks: readonly LocatedHunk[], baseLineCount: number): string | null;
/** Final-newline decision for hunks already known to apply to a base of `baseLineCount` lines. */
export declare function eofNewlineDecision(hunks: readonly LocatedHunk[], baseLineCount: number): EofNewlineDecision;
export declare function resolveEofNewline(decision: EofNewlineDecision, fileEndsWithNewline: boolean): boolean;
/** True when any hunk body line contains a CR (a CR-aware patch). */
export declare function patchCarriesCr(hunks: readonly UnifiedPatchHunk[]): boolean;
/**
 * New-side lines of a hunk (context and added, in order) as they land in the
 * file (#362 AC3). Context lines are the exact matched text.
 * - A patch that carries CR anywhere is applied verbatim: each added line keeps
 *   exactly the terminator written in the patch, as `git apply` does.
 * - A CR-free patch states no line-ending intent. Its added lines follow the
 *   nearest old line: inside a hunk with context that is a matched LF line, so
 *   the result equals git's; a pure insertion (no old lines) takes the EOL of
 *   the file line before the insertion point (else the one after it); a CR on
 *   a final line without a newline is content, not an EOL, and is ignored. This
 *   pure-insertion case is the only place the result can differ from
 *   `git apply`, which would insert a bare LF line into a CRLF run.
 * A line that ends the file without a newline never gains a CR.
 */
export declare function newSideLineTexts(hunk: UnifiedPatchHunk, sourceLines: readonly string[], index: number, carriesCr: boolean, endsWithNewline: boolean): string[];
/** Parse, locate with exact context, and apply one file's unified patch. */
export declare function applyUnifiedPatchDetailed(before: string, patchText: string, options?: {
    targetFile?: string;
    mode?: HunkLocateMode;
    window?: number;
}): {
    text: string;
    hunkOffsets: HunkOffset[];
    located: LocatedHunk[];
};
/** Apply already parsed hunks so callers can validate once before overlap checks. */
export declare function applyParsedUnifiedPatchDetailed(before: string, hunks: readonly UnifiedPatchHunk[], options?: {
    mode?: HunkLocateMode;
    window?: number;
}): {
    text: string;
    hunkOffsets: HunkOffset[];
    located: LocatedHunk[];
};
export declare function applyUnifiedPatch(before: string, patchText: string, options?: {
    targetFile?: string;
    mode?: HunkLocateMode;
    window?: number;
}): string;
