export interface TaskflowBranchCommitQueueGate {
    readonly schemaId: 'atm.taskflowBranchCommitQueueGate.v1';
    readonly status: 'clear' | 'busy';
    readonly branchRef: string | null;
    readonly branchName: string;
    readonly lockPath: string | null;
    readonly actorId: string | null;
    readonly summary: string;
    readonly requiredCommand: string | null;
    readonly brokerTicket?: TaskflowBrokerTicket | null;
}
export interface TaskflowBrokerTicket {
    readonly schemaId: 'atm.brokerTicket.v1';
    readonly ticketId: string;
    readonly position: number;
    readonly headOwner: string | null;
    readonly headHealth: 'task-active';
    readonly batchEligible: boolean;
    readonly enqueuedAt: string;
    readonly waitedMs: number;
    readonly sharedSurface: string;
    readonly scopeClass: readonly string[];
}
export declare function evaluateTaskflowBranchCommitQueueGate(input: {
    cwd: string;
    taskId: string;
    actorId: string;
}): TaskflowBranchCommitQueueGate;
