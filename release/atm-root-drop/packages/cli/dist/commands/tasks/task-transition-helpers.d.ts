import { type TaskTransitionClosureMetadata } from '../task-ledger.ts';
import type { WorkItemRef } from '@ai-atomic-framework/core';
import type { ClosurePacket } from '../framework-development.ts';
/**
 * Asserts local task ledger policy is enabled.
 */
export declare function assertLocalTaskLedgerEnabled(cwd: string, action: string): void;
/**
 * Builds standard transition command strings consistently.
 */
export declare function buildTaskTransitionCommand(input: {
    readonly action: string;
    readonly taskId: string;
    readonly actorId: string | null;
    readonly status?: string | null;
    readonly fromBatchCheckpoint?: boolean;
    readonly batchId?: string | null;
    readonly historicalDeliveryRefs?: readonly string[];
}): string;
/**
 * Packs metadata for task closure transitions.
 */
export declare function createClosureTransitionMetadata(closurePacketPath: string | null, closurePacket: ClosurePacket | null, batchId?: string | null, sessionId?: string | null): TaskTransitionClosureMetadata | null;
/**
 * Normalizes work item statuses securely.
 */
export declare function normalizeWorkItemStatus(value: unknown): WorkItemRef['status'];
/**
 * Inspects verify status with aliases check.
 */
export declare function inspectTaskVerifyStatus(value: unknown): {
    readonly ok: boolean;
    readonly normalizedStatus: string | null;
    readonly warningCode: string | null;
};
