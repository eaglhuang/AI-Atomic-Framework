export declare function resolveGitExecutable(): string;
export interface GitUnexpectedStagedTaskReport {
    readonly taskId: string;
    readonly stagedFiles: readonly string[];
    readonly restoreChoice: string;
    readonly deferCommand: string;
}
export interface TaskScopedCommitBundleReport {
    readonly schemaId: 'atm.taskScopedCommitBundle.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly apply: boolean;
    readonly stageFiles: readonly string[];
    readonly skippedExternalDirtyFiles: readonly string[];
    readonly unexpectedStagedTasks: readonly GitUnexpectedStagedTaskReport[];
    readonly outOfScopeStagedFiles: readonly string[];
    readonly governanceBundleWarnings: readonly string[];
    readonly blockedCode: string | null;
    readonly blockedSummary: string | null;
    readonly gitExecutable: string;
    readonly copyableCommitCommand: string | null;
    readonly deferredForeignStagedSnapshot: string | null;
}
export interface GitGovernanceViolation {
    readonly code: string;
    readonly detail: string;
}
export interface GitGovernanceCheckResult {
    readonly ok: boolean;
    readonly actorId: string;
    readonly taskId: string | null;
    readonly claimLeaseId: string | null;
    readonly sessionId: string | null;
    readonly gitName: string | null;
    readonly gitEmail: string | null;
    readonly trailers: Readonly<Record<string, readonly string[]>>;
    readonly violations: readonly GitGovernanceViolation[];
}
export declare function runAtmGit(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function evaluateGitGovernanceCheck(input: {
    cwd: string;
    actorInput: string | null;
    taskId: string | null;
    sessionId?: string | null;
    requireTrailers: boolean;
}): GitGovernanceCheckResult;
export declare function resolveTaskScopedCommitBundle(input: {
    cwd: string;
    taskId: string;
    taskDocument: Record<string, unknown>;
    apply: boolean;
    autoStage: boolean;
    deferForeignStaged: boolean;
    message: string;
    actorId: string;
    trailers: readonly string[];
}): TaskScopedCommitBundleReport;
