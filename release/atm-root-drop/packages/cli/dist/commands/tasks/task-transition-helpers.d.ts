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
 * 建構 `tasks scope add` / `tasks scope repair` 的可重現指令字串。
 * 正常稽核通道（add）帶 class/phase/reason；維護通道（repair）帶 reason 與
 * emergency-approval。供稽核事件 command 欄位與輸出 requiredCommand 使用，確保兩條
 * 通道的指令格式一致。
 */
export declare function buildScopeAmendmentCommand(input: {
    readonly mode: 'normal' | 'repair';
    readonly taskId: string;
    readonly actorId: string;
    readonly addPaths: readonly string[];
    readonly amendmentClass?: string | null;
    readonly amendmentPhase?: string | null;
    readonly reason?: string | null;
    readonly emergencyApproval?: string | null;
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
