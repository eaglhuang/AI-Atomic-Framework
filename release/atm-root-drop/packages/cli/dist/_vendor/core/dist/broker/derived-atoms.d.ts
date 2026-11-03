import { type BridgeAtomCandidate } from './candidate-bridge.js';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntentAtomRef } from './types.js';
/**
 * Derived atom identity helpers (TASK-ASP-0006).
 *
 * A derived atom is computed from source code on demand; it is never stored
 * as a second registry. These helpers make the candidate list identity-stable
 * before `computeCandidateAtomCid` hashes it:
 *
 * - consecutive same-kind, same-symbol candidates in one file (TypeScript
 *   overload signatures followed by the implementation) merge into one atom;
 * - remaining same-kind, same-symbol duplicates get an `ordinal` in source
 *   order. Atoms without duplicates carry no ordinal, so their CID does not
 *   move when unrelated code is added. Inserting a new same-name atom before
 *   an existing one shifts that atom's ordinal (documented limitation).
 */
export declare function normalizeDerivedCandidates<T extends BridgeAtomCandidate>(candidates: readonly T[]): T[];
/**
 * Content version of a line range: SHA-256 over the range text with line
 * endings normalized to LF, so CRLF and LF checkouts agree. Changes here do
 * not change the atom CID.
 */
export declare function computeAtomContentVersion(sourceText: string, lineStart: number, lineEnd: number): string;
/** Symbol of the per-file preamble pseudo-atom (imports and top-level statements before the first atom). */
export declare const DERIVED_PREAMBLE_SYMBOL = "#preamble";
export interface DerivedAtom {
    readonly atomId: string;
    readonly atomCid: string;
    readonly kind: string;
    readonly symbol: string;
    readonly ordinal?: number;
    readonly region: 'symbol' | 'preamble';
    readonly confidence: 'high' | 'medium' | 'low';
    readonly sourceRange: {
        readonly filePath: string;
        readonly lineStart: number;
        readonly lineEnd: number;
    };
    readonly contentVersion: string;
}
export interface LineSpan {
    readonly start: number;
    readonly end: number;
}
export interface DiffHunk {
    readonly oldSpan: LineSpan | null;
    readonly newSpan: LineSpan;
    readonly addedLines: string[];
    readonly removedLines: string[];
}
export interface FileLineChanges {
    readonly oldSpans: LineSpan[];
    readonly newSpans: LineSpan[];
    readonly hunks: DiffHunk[];
}
/**
 * Derive the atoms of one file (TASK-ASP-0007). Candidates come from the
 * language adapter; low-confidence candidates are dropped by default so a
 * guess never narrows occupancy. A file with no qualifying candidate yields no
 * atoms, which callers treat as file-level (today's behaviour).
 */
export declare function deriveFileAtoms(input: {
    readonly filePath: string;
    readonly sourceText: string;
    readonly candidates: readonly BridgeAtomCandidate[];
    readonly minConfidence?: 'high' | 'medium' | 'low';
}): DerivedAtom[];
/** WriteIntent references for derived atoms: they already exist, so the operation is `modify`. */
export declare function derivedAtomRefs(atoms: readonly DerivedAtom[]): WriteIntentAtomRef[];
/**
 * Parse `git diff -U0` output into changed line spans on both sides, keyed by
 * the post-image path. A pure deletion is recorded as a one-line span at the
 * deletion point on the new side and as the removed lines on the old side.
 */
export declare function parseUnifiedZeroDiff(diffText: string): Map<string, FileLineChanges>;
/**
 * Atoms actually touched by a change (TASK-ASP-0008): old-side atoms that
 * intersect removed lines plus new-side atoms that intersect added lines, so a
 * deleted atom and a newly added atom are both visible. A changed non-blank
 * line outside every atom makes the change file-level (`fileLevel: true`).
 */
export declare function atomsTouchedByChange(input: {
    readonly oldAtoms: readonly DerivedAtom[];
    readonly newAtoms: readonly DerivedAtom[];
    readonly oldSpans: readonly LineSpan[];
    readonly newSpans: readonly LineSpan[];
    readonly oldText: string;
    readonly newText: string;
}): {
    readonly touched: DerivedAtom[];
    readonly fileLevel: boolean;
};
/**
 * Import preamble rule (TASK-ASP-0009): a preamble change commutes with other
 * work only when it purely adds import lines (blank lines allowed). Any
 * removed line or non-import addition keeps the preamble exclusive.
 */
export declare function isAdditiveImportChange(removedLines: readonly string[], addedLines: readonly string[]): boolean;
/**
 * Whether the part of a change that falls in the preamble is a pure import
 * addition. Hunks that do not touch either side's preamble are ignored, so a
 * function edit elsewhere in the file does not make the preamble exclusive.
 */
export declare function isPreambleChangeAdditive(input: {
    readonly hunks: readonly DiffHunk[];
    readonly oldAtoms: readonly DerivedAtom[];
    readonly newAtoms: readonly DerivedAtom[];
}): boolean;
export interface DerivedAtomConflict {
    readonly taskId: string;
    readonly atomCid: string;
    readonly filePath: string;
    readonly reason: 'same-atom' | 'file-level-change';
}
export interface DerivedFileConfirmation {
    readonly filePath: string;
    readonly touched: readonly DerivedAtom[];
    readonly fileLevel: boolean;
    readonly preambleAdditive: boolean;
}
/**
 * Compare atoms confirmed by this change against atoms other active tasks have
 * reserved or confirmed. Only declared/confirmed atoms count: an undeclared
 * task holds a shareable file-level claim and is decided when it commits.
 */
export declare function findDerivedAtomConflicts(input: {
    readonly taskId: string;
    readonly files: readonly DerivedFileConfirmation[];
    readonly activeIntents: readonly ActiveWriteIntent[];
}): DerivedAtomConflict[];
/**
 * Record confirmed atoms on this task's active intent so later claims and
 * commits see them through the existing VirtualAtomInUse projection. Earlier
 * reservations and confirmations are kept (union); they are released with the
 * intent when the task closes.
 */
export declare function mergeIntentDerivedAtoms(doc: WriteBrokerRegistryDocument, taskId: string, refs: readonly WriteIntentAtomRef[]): WriteBrokerRegistryDocument;
