export interface TaskflowBrokerConflictGate {
    readonly schemaId: 'atm.taskflowBrokerConflictGate.v1';
    readonly verdict: 'confirmedConflict' | 'takeoverRequired' | 'insufficientMutationIntent' | 'noConflict';
    readonly confirmedConflict: boolean;
    readonly overlappingTaskIds: readonly string[];
    readonly summary: string;
    readonly requiredCommand: string | null;
    readonly brokerVerdict: string | null;
    readonly decisionClass: 'serial-release' | 'blocked' | null;
    readonly decisionReason: string | null;
    readonly violationStatus: 'broker-conflict-blocked' | null;
    readonly statusCode: 'broker-conflict-blocked' | null;
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
export declare function evaluateTaskflowBrokerConflictGate(input: {
    cwd: string;
    taskId: string;
    declaredFiles: readonly string[];
    actorId?: string | null;
}): TaskflowBrokerConflictGate;
