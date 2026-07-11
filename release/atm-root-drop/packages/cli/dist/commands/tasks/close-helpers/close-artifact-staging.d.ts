import type { TaskClaimRecord } from '@ai-atomic-framework/core';
import type { TaskDeliverableGateReport } from '../result-contracts.ts';
export declare function extractTaskCloseDeclaredFiles(taskDocument: Record<string, unknown>, cwd?: string, taskId?: string, options?: {
    checkpointScoped?: boolean;
}): readonly string[];
export declare function extractTaskDeliverableFiles(taskDocument: Record<string, unknown>): readonly string[];
export declare function taskDeliveryPrincipleText(): string;
export declare function evaluateTaskDeliverableGate(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskDocument: Record<string, unknown>;
    readonly taskDeclaredFiles: readonly string[];
    readonly claim: TaskClaimRecord | null;
    readonly historicalDeliveryRefs?: readonly string[];
    readonly historicalDeliveryRepo?: string | null;
    readonly waiverOutOfScopeDelivery?: boolean;
    readonly waiverReason?: string | null;
}): TaskDeliverableGateReport;
export declare function stageTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]): void;
export declare function existingTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]): readonly string[];
