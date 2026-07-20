import type { TaskClaimRecord } from '@ai-atomic-framework/core';
/**
 * Reads a single git output scalar securely.
 */
export declare function readGitScalar(cwd: string, args: readonly string[]): string | null;
/**
 * List files committed to Git index since claim heartbeat.
 */
export declare function listCommittedFilesSinceClaim(cwd: string, claim: TaskClaimRecord | null): {
    readonly files: readonly string[];
    readonly gitAvailable: boolean;
};
