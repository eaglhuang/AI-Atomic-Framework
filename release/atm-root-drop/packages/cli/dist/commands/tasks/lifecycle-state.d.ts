export type TaskClaimIntent = 'write' | 'closeout-only';
export interface TaskLifecycleAdmissionOk {
    readonly ok: true;
    readonly reason: string;
}
export interface TaskLifecycleAdmissionBlocked {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
}
export type TaskLifecycleAdmission = TaskLifecycleAdmissionOk | TaskLifecycleAdmissionBlocked;
export declare function normalizeTaskLifecycleStatus(value: unknown): string;
export declare function evaluateTaskPromotionAdmission(input: {
    readonly taskId: string;
    readonly status: unknown;
}): TaskLifecycleAdmission;
export declare function evaluateTaskResetAdmission(input: {
    readonly taskId: string;
    readonly fromStatus: unknown;
    readonly toStatus: string;
}): TaskLifecycleAdmission;
export declare function evaluateTaskClaimAdmission(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly status: unknown;
    readonly claimIntent: TaskClaimIntent;
}): TaskLifecycleAdmission;
export declare function evaluateTaskDoneCloseAdmission(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly status: unknown;
    readonly claimState: string | null;
    readonly claimActorId: string | null;
    readonly hasActiveSession: boolean;
}): TaskLifecycleAdmission;
