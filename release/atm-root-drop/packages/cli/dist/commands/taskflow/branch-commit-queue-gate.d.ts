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
    readonly waveId?: string | null;
    readonly surfaceFamily?: string;
    readonly batch?: TaskflowBrokerBatchEvidence | null;
    readonly enqueuedAt: string;
    readonly waitedMs: number;
    readonly sharedSurface: string;
    readonly scopeClass: readonly string[];
}
export interface TaskflowBrokerBatchEvidence {
    readonly schemaId: 'atm.brokerBatchEvidence.v1';
    readonly batchId: string;
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly ticketIds: readonly string[];
    readonly sharedSurfaceFamily: string;
    readonly validators: readonly string[];
    readonly batchRate: number;
    readonly buildsPerWave: number;
}
export declare function evaluateTaskflowBranchCommitQueueGate(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    waveId?: string | null;
    surfaceFamily?: string | null;
    validators?: readonly string[];
}): TaskflowBranchCommitQueueGate;
