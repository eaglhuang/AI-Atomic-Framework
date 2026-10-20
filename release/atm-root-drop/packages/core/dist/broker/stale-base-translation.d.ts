import { type HunkOffset, type LocatedHunk, type UnifiedPatchHunk } from './unified-patch.js';
/** One contiguous change: base tokens [baseStart, baseEnd) become `added`. */
export interface LineChangeBlock {
    readonly baseStart: number;
    readonly baseEnd: number;
    readonly added: readonly string[];
}
/** A stale-patch block placed in current coordinates. */
export interface TranslatedBlock extends LineChangeBlock {
    /** Current tokens [currentStart, currentEnd) are replaced; equal to the base tokens they came from. */
    readonly currentStart: number;
    readonly currentEnd: number;
}
export interface StaleBaseConflict {
    /** The stale patch's change, in base line indexes (0-based, end exclusive). */
    readonly ours: {
        readonly baseStart: number;
        readonly baseEnd: number;
    };
    /** The change made since the base that it overlaps or touches. */
    readonly theirs: {
        readonly baseStart: number;
        readonly baseEnd: number;
        readonly currentStart: number;
        readonly currentEnd: number;
    };
}
export type StaleBaseTranslation = {
    readonly ok: true;
    readonly text: string;
    readonly blocks: readonly TranslatedBlock[];
    /** Hunks located in current coordinates (index = current line index of the hunk's first old line). */
    readonly located: readonly LocatedHunk[];
    readonly hunkOffsets: readonly HunkOffset[];
} | {
    readonly ok: false;
    readonly reason: 'stale-base-conflict' | 'patch-context-mismatch';
    readonly detail: string;
    readonly conflicts: readonly StaleBaseConflict[];
};
/** Lines with their own terminator; the last one has none when the text does not end in LF. */
export declare function lineTokens(text: string): string[];
interface DiffBlock {
    readonly aStart: number;
    readonly aEnd: number;
    readonly bStart: number;
    readonly bEnd: number;
}
/** Minimal line diff (Myers) as change blocks, after trimming the common prefix and suffix. */
export declare function diffLineBlocks(a: readonly string[], b: readonly string[]): DiffBlock[];
/** Change blocks of a patch located in `baseTokens`, taken from the patch structure. */
export declare function patchChangeBlocks(baseTokens: readonly string[], oursTokens: readonly string[], located: readonly LocatedHunk[]): LineChangeBlock[];
/**
 * Current line index of base line `index` for a base line no change touched,
 * or of the gap before it; null when a base-to-current change covers it.
 */
export declare function mapBaseLineForward(index: number, theirs: readonly DiffBlock[]): number | null;
/**
 * Translate a patch written against `baseText` onto `currentText`.
 * The patch is located in the base with the #359 locator (its line numbers are
 * valid there); `git merge-file` conflict semantics decide whether it still applies.
 */
export declare function translateStalePatch(input: {
    readonly baseText: string;
    readonly currentText: string;
    readonly hunks: readonly UnifiedPatchHunk[];
}): StaleBaseTranslation;
/** Render translated blocks as a zero-context patch in current coordinates. */
export declare function renderTranslatedPatch(filePath: string, currentText: string, blocks: readonly TranslatedBlock[]): string;
/** The committed version of `file` whose content hash is `declaredHash`, searching recent history. */
export declare function findCommittedBaseText(cwd: string, file: string, declaredHash: string, maxCommits?: number): string | null;
export {};
