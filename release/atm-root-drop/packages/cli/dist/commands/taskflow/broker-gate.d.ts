export interface TaskflowBrokerConflictGate {
    readonly schemaId: 'atm.taskflowBrokerConflictGate.v1';
    readonly verdict: 'confirmedConflict' | 'takeoverRequired' | 'insufficientMutationIntent' | 'noConflict';
    readonly confirmedConflict: boolean;
    readonly overlappingTaskIds: readonly string[];
    readonly summary: string;
    readonly requiredCommand: string | null;
    readonly brokerVerdict: string | null;
}
export declare function evaluateTaskflowBrokerConflictGate(input: {
    cwd: string;
    taskId: string;
    declaredFiles: readonly string[];
    actorId?: string | null;
}): TaskflowBrokerConflictGate;
