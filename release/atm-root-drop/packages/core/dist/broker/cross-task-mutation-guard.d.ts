export interface CrossTaskMutationBlock {
    readonly conflictTaskId: string;
    readonly conflictFiles: readonly string[];
    readonly commandFamily: string;
    readonly recoveryLane: string;
    readonly conflicts: readonly CrossTaskMutationConflict[];
}
export interface CrossTaskMutationConflict {
    readonly conflictTaskId: string;
    readonly conflictFiles: readonly string[];
    readonly owner: string;
    readonly surface: 'task-history' | 'active-task-scope';
}
export interface ActiveTaskInfo {
    readonly taskId: string;
    readonly owner: string;
    readonly allowedFiles: readonly string[];
}
export declare function getActiveTasks(cwd: string): readonly ActiveTaskInfo[];
export declare function detectCrossTaskMutation(cwd: string, currentTaskId: string | null, commandFamily: string): CrossTaskMutationBlock | null;
export declare function recordIncidentFlag(cwd: string, block: CrossTaskMutationBlock): void;
export declare function readIncidentFlag(cwd: string): CrossTaskMutationBlock | null;
export declare function clearIncidentFlags(cwd: string): void;
