export type TaskDeliveryIntent = 'framework-delivery' | 'mirror-sync-only' | 'cross-repo-delivery' | 'unknown';
export interface TaskDeliveryClassification {
    readonly intent: TaskDeliveryIntent;
    readonly reason: string;
    readonly targetRepo: string | null;
    readonly closureAuthority: string | null;
    readonly planningRepo: string | null;
    readonly ledgerStatus: string | null;
    readonly sourceStatus: string | null;
    readonly statusDivergence: boolean;
    readonly recommendedActions: readonly string[];
    readonly diagnostics: readonly string[];
}
export interface ClassifyTaskDeliveryInput {
    readonly cwd: string;
    readonly task: {
        readonly workItemId: string;
        readonly status: string;
        readonly targetRepo: string | null;
        readonly closureAuthority: string | null;
        readonly planningRepo?: string | null;
        readonly sourcePlanPath: string | null;
        readonly taskPath: string;
    };
}
/**
 * Classify how a task should be delivered from the current cwd, based on
 * machine fields preserved by `tasks import` (target_repo, closure_authority,
 * planning_repo) and the canonical source task-card status.
 *
 * This is used by `next` to avoid suggesting a delivery playbook when the task
 * actually lives in a different repo or already shipped upstream.
 */
export declare function classifyTaskDelivery(input: ClassifyTaskDeliveryInput): TaskDeliveryClassification;
