import type { TaskflowClosebackPlan } from './closeback-orchestration.ts';
import { type TaskflowBranchCommitQueueGate } from './branch-commit-queue-gate.ts';
import { type TaskflowBrokerConflictGate } from './broker-gate.ts';
export interface TaskflowCloseKnownBlocker {
    readonly code: string;
    readonly summary: string;
    readonly requiredCommand: string | null;
    readonly multiTaskCloseRecipe?: string | null;
}
export declare function buildSharedDeliveryWaiverCommand(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly historicalRef: string;
}): string;
export declare function prioritizeSharedHistoricalDeliveryBlockers(blockers: readonly TaskflowCloseKnownBlocker[], input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly historicalDeliveryRef: string | null;
    readonly outOfScopeFiles?: readonly string[];
}): TaskflowCloseKnownBlocker[];
export interface TaskflowCloseWriteReadinessHint {
    readonly schemaId: 'atm.taskflowCloseWriteReadinessHint.v1';
    readonly status: 'ready' | 'blocked';
    readonly summary: string;
    readonly blockers: readonly TaskflowCloseKnownBlocker[];
    readonly nextCommand: string | null;
    readonly operatorLane: 'taskflow close';
    readonly brokerConflictGate: TaskflowBrokerConflictGate;
    readonly branchCommitQueueGate: TaskflowBranchCommitQueueGate;
}
export declare function buildTaskflowCloseWriteReadinessHint(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    taskDocument: Record<string, unknown>;
    declaredFiles: readonly string[];
    closebackPlan: TaskflowClosebackPlan;
    previewCommitBundle: {
        targetDeliveryFiles: readonly string[];
    };
    historicalDeliveryRefs: readonly string[];
    waiverOutOfScopeDelivery?: boolean;
    waiverReason?: string | null;
    planningAuthorityDeliveryGate: {
        required: boolean;
        ok: boolean;
        repoRoot: string | null;
        matchedFiles: string[];
        reason: string | null;
    };
}): TaskflowCloseWriteReadinessHint;
