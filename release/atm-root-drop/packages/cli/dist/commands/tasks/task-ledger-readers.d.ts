import type { TaskClaimRecord } from '@ai-atomic-framework/core';
export declare function parseClaimRecord(value: unknown): TaskClaimRecord | null;
export declare function createClaimRecord(input: {
    taskId: string;
    actorId: string;
    files: readonly string[];
    ttlSeconds: number;
    timestamp: string;
}): TaskClaimRecord;
export declare function isClaimExpired(claim: TaskClaimRecord, nowIso: string): boolean;
export declare function listRuntimeLockTaskIds(cwd: string): readonly string[];
