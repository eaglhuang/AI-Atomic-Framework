import { type CommittedEntry } from './live-write-journal-store.js';
export declare class GitIndexContentionError extends Error {
}
export declare function proposalCommitSha(cwd: string, proposalId: string): string | null;
export declare function commitLiveWrite(cwd: string, target: string, before: string, after: string, entry: CommittedEntry): string;
/** Recover only bytes whose identity is proven; never overwrite an unknown edit. */
export declare function reconcileLiveWrites(cwd: string, file: string): void;
