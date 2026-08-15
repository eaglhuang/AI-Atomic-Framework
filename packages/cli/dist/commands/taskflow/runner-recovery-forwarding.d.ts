export declare const TASKFLOW_RUNNER_RECOVERY_DECISION_SCHEMA_ID: "atm.taskflowRunnerRecoveryDecision.v1";
export interface TaskflowRunnerRecoveryDecision {
    readonly schemaId: typeof TASKFLOW_RUNNER_RECOVERY_DECISION_SCHEMA_ID;
    readonly publicationAccepted: boolean;
    readonly frozenShaEqualsHead: boolean;
    readonly runnerSyncRequired: boolean;
    readonly emergencyLeaseId: string | null;
    readonly recoveryRequired: boolean;
    readonly forwardAllowStaleRunner: boolean;
    readonly forwardEmergencyApproval: boolean;
    readonly blocksDryRun: boolean;
    readonly reason: string;
}
export interface TaskflowRunnerRecoveryInput {
    readonly runnerPublicationAccepted: boolean;
    readonly emergencyApproval?: unknown;
    readonly sealedSourceSha?: string | null;
    readonly currentHead?: string | null;
    readonly runnerSyncRequired?: boolean;
}
export declare function decideTaskflowRunnerRecovery(input: TaskflowRunnerRecoveryInput): TaskflowRunnerRecoveryDecision;
export declare function buildTaskflowRunnerRecoveryArgs(input: TaskflowRunnerRecoveryInput | TaskflowRunnerRecoveryDecision): readonly string[];
