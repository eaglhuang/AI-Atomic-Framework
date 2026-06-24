export interface TaskflowBranchCommitQueueGate {
    readonly schemaId: 'atm.taskflowBranchCommitQueueGate.v1';
    readonly status: 'clear' | 'busy';
    readonly branchRef: string | null;
    readonly branchName: string;
    readonly lockPath: string | null;
    readonly actorId: string | null;
    readonly summary: string;
    readonly requiredCommand: string | null;
}
export declare function evaluateTaskflowBranchCommitQueueGate(input: {
    cwd: string;
    taskId: string;
    actorId: string;
}): TaskflowBranchCommitQueueGate;
