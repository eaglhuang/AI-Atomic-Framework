import type { CommittedBlock } from './cross-session-overlap.js';
export interface CommittedEntry {
    readonly kind?: 'committed';
    readonly file: string;
    readonly proposalId: string;
    readonly actorId?: string | null;
    readonly baseHash: string;
    readonly afterHash: string;
    readonly changedLines: readonly number[];
    readonly blocks?: readonly CommittedBlock[];
    readonly commitSha?: string | null;
    readonly acknowledgedOverlap?: readonly string[];
}
export type IntentEntry = Omit<CommittedEntry, 'kind'> & {
    readonly kind: 'intent';
    readonly backup: string;
};
export type JournalEntry = CommittedEntry | IntentEntry | {
    readonly kind: 'abandoned';
    readonly proposalId: string;
};
export declare class RecoveryRequiredError extends Error {
}
export declare function isCommitted(entry: JournalEntry): entry is CommittedEntry;
export declare function journalPath(cwd: string): string;
export declare function readJournal(cwd: string): JournalEntry[];
export declare function appendJournal(cwd: string, entry: JournalEntry): void;
