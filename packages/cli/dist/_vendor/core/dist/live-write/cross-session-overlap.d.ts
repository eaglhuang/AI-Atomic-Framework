/** One committed change: before tokens [beforeStart, beforeEnd) became after tokens [afterStart, afterEnd). */
export interface CommittedBlock {
    readonly beforeStart: number;
    readonly beforeEnd: number;
    readonly afterStart: number;
    readonly afterEnd: number;
    readonly removed: readonly string[];
    readonly added: readonly string[];
}
/** The #360 fields of a live-write journal entry (absent on entries written before #360). */
export interface OverlapJournalFields {
    readonly kind?: 'committed' | 'intent' | 'abandoned';
    readonly file: string;
    readonly baseHash: string;
    readonly afterHash: string;
    readonly proposalId: string;
    readonly actorId?: string | null;
    readonly commitSha?: string | null;
    readonly blocks?: readonly CommittedBlock[];
    readonly acknowledgedOverlap?: readonly string[];
}
/** A current-coordinate range [start, end) of lines a write deletes or modifies. */
export interface LineRange {
    readonly start: number;
    readonly end: number;
}
export interface CrossSessionOverlap {
    readonly actorId: string;
    readonly proposalId: string;
    readonly commitSha: string | null;
    readonly afterHash: string;
    /** 1-based inclusive current line ranges of the other session's lines this write targets. */
    readonly currentLines: readonly {
        readonly start: number;
        readonly end: number;
    }[];
    /** The other session's diff for those lines. */
    readonly diff: string;
}
export interface AnchorRecord {
    readonly actorId: string;
    readonly taskId: string | null;
    readonly file: string;
    readonly baseHash: string;
    readonly proposalId: string;
    readonly journalIndex: number;
    readonly recordedAt: string;
}
export declare const CROSS_SESSION_OVERLAP_INSTRUCTION = "Another session changed the lines this write deletes or modifies. Re-decide explicitly: submit a patch that keeps their change (merge both intents), abandon this edit, or resubmit with --ack-overlap naming every listed proposalId to override it on purpose.";
/** Change blocks between two texts, from a list of [start, end) replacements in `before` coordinates. */
export declare function committedBlocks(before: string, changes: readonly {
    start: number;
    end: number;
    added: readonly string[];
}[]): CommittedBlock[];
/** Fallback when the patch structure is not available: a line diff. */
export declare function diffCommittedBlocks(before: string, after: string): CommittedBlock[];
/** Records the actor's anchor for the file on its first proposal; returns it and whether it already existed. */
export declare function ensureAnchor(cwd: string, input: {
    actorId: string;
    taskId: string | null;
    file: string;
    declaredHash: string;
    proposalId: string;
    journalLength: number;
}): {
    anchor: AnchorRecord;
    existed: boolean;
};
export declare function readAnchors(cwd: string): AnchorRecord[];
export declare function anchorsRelativePath(): string;
/**
 * Journal entries for the file committed since the anchor base (journal order).
 * The anchor is located on the journal's hash chain; when its hash is not on the
 * chain, Git ancestry decides (entries whose commit descends from the newest
 * commit holding the anchor text); when that is unknown too, every entry counts (fail closed).
 */
export declare function entriesSinceAnchor<T extends OverlapJournalFields>(cwd: string, entries: readonly T[], anchor: AnchorRecord, currentHash: string): T[];
/**
 * Other sessions' committed lines (since the anchor) that the targeted current
 * ranges delete or modify. Each entry's lines are carried forward through the
 * later journal entries' own change blocks (exact provenance, so duplicate lines
 * stay attributed); where the chain breaks (an out-of-band commit or a pre-#360
 * entry) the rest is mapped with a line diff to the current text. `readAfterText`
 * returns the file text right after an entry's commit (null when unavailable).
 * A pure deletion owns no remaining line; `includeDeletionGaps` (classification of
 * an already-rejected write only) also counts a write spanning the deletion gap.
 */
export declare function findCrossSessionOverlaps(input: {
    readonly actorId: string;
    readonly currentText: string;
    readonly currentHash: string;
    readonly entries: readonly OverlapJournalFields[];
    readonly targets: readonly LineRange[];
    readonly readAfterText: (entry: OverlapJournalFields) => string | null;
    readonly includeDeletionGaps?: boolean;
}): CrossSessionOverlap[];
/** A line's index after one committed change, or null when the change rewrote it. */
export declare function mapThroughBlocks(line: number, blocks: readonly CommittedBlock[]): number | null;
/** The text of `file` at `commitSha`, or null. */
export declare function gitFileAt(cwd: string, commitSha: string | null | undefined, file: string): string | null;
export declare function describeOverlaps(overlaps: readonly CrossSessionOverlap[]): string;
