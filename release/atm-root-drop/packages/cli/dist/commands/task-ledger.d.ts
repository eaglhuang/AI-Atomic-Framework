export type TaskLedgerMode = 'adopter-governed' | 'framework-development' | 'external-provider';
export type TaskLedgerConfiguredMode = 'auto' | TaskLedgerMode;
export interface ExternalTaskReference {
    readonly provider: string;
    readonly taskId: string;
    readonly url?: string | null;
}
export interface TaskLedgerPolicy {
    readonly enabled: boolean;
    readonly configuredMode: TaskLedgerConfiguredMode;
    readonly provider: string;
    readonly mirrorExternalTasks: boolean;
    readonly requireCliTransitions: boolean;
    readonly taskRoot: string;
    readonly eventRoot: string;
    readonly externalTasks: readonly ExternalTaskReference[];
}
export interface TaskTransitionEvent {
    readonly schemaId: 'atm.taskTransition.v1';
    readonly specVersion: '0.1.0';
    readonly transitionId: string;
    readonly taskId: string;
    readonly action: string;
    readonly actorId: string | null;
    readonly sessionId?: string | null;
    readonly fromStatus: string | null;
    readonly toStatus: string | null;
    readonly taskPath: string;
    readonly taskSha256: string;
    readonly createdAt: string;
    readonly command: string;
    readonly originProvider?: string;
    readonly originTaskId?: string;
    readonly closure?: TaskTransitionClosureMetadata;
}
export interface TaskTransitionRequiredGatesSnapshot {
    readonly schemaId: 'atm.requiredGatesSnapshot.v1';
    readonly generatedAt: string;
    readonly source: 'frameworkStatus.requiredGates';
    readonly ruleVersion: string;
    readonly frameworkMode: string;
    readonly repoRole: 'framework' | 'host';
    readonly changedFiles: readonly string[];
    readonly criticalChangedFiles: readonly string[];
    readonly requiredGates: readonly string[];
}
export interface TaskTransitionClosureMetadata {
    readonly schemaId: 'atm.taskClosureTransition.v1';
    readonly batchId?: string | null;
    readonly sessionId?: string | null;
    readonly closurePacketPath: string | null;
    readonly evidenceFreshness: 'fresh' | 'historical-reference' | 'draft' | null;
    readonly validationPasses: readonly string[];
    readonly requiredGates: readonly string[];
    readonly requiredGatesSnapshot: TaskTransitionRequiredGatesSnapshot | null;
}
export declare function readTaskLedgerPolicy(cwd: string): TaskLedgerPolicy;
export declare function resolveTaskLedgerMode(input: {
    readonly policy: TaskLedgerPolicy;
    readonly frameworkMode: string;
    readonly repoRole: string;
    readonly closureAuthority: string;
}): TaskLedgerMode;
export declare function appendTaskTransitionEvent(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly action: string;
    readonly actorId?: string | null;
    readonly sessionId?: string | null;
    readonly fromStatus?: string | null;
    readonly toStatus?: string | null;
    readonly taskPath: string;
    readonly taskDocument: Record<string, unknown>;
    readonly command?: string;
    readonly closureMetadata?: TaskTransitionClosureMetadata | null;
    readonly createdAt?: string;
    readonly transitionId?: string;
}): {
    transitionId: string;
    eventPath: string;
    event: TaskTransitionEvent;
};
export declare function createTaskTransitionId(input: {
    readonly createdAt: string;
    readonly taskId: string;
    readonly action: string;
    readonly taskDocument: Record<string, unknown>;
}): string;
export declare function transitionEventExists(cwd: string, taskId: string, transitionId: string): boolean;
export declare function externalTaskKey(provider: string, taskId: string): string;
export declare function defaultMirrorTaskId(provider: string, originTaskId: string): string;
