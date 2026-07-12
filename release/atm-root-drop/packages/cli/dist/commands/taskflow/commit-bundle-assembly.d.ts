export type TaskflowCommitMode = 'auto-commit' | 'stage-only' | 'dry-run';
export interface TaskflowIndexIsolation {
    verified: boolean;
    expectedStageFiles: string[];
    preStagedFiles: string[];
    unexpectedStagedFiles: string[];
}
export interface TaskflowCommitRepoBundle {
    repoRoot: string | null;
    stageFiles: string[];
    commitMessage: string;
    commitCommand: string;
    commitSha: string | null;
    status: 'preview' | 'staged' | 'committed' | 'skipped' | 'failed' | 'uncomputed';
    reason?: string | null;
    indexIsolation?: TaskflowIndexIsolation;
}
export interface TaskflowScopeAmendmentProposal {
    required: boolean;
    candidateFiles: string[];
    reason: string | null;
    remediationCommand: string | null;
    humanReviewRequired: boolean;
    notes: string[];
}
export interface TaskflowGovernedCommitBundle {
    schemaId: 'atm.taskflowGovernedCommitBundle.v1';
    taskId: string;
    actorId: string | null;
    targetRepo: TaskflowCommitRepoBundle;
    planningRepo: TaskflowCommitRepoBundle;
    commitMode: TaskflowCommitMode;
    failClosed: boolean;
    recoveryCommand: string | null;
    targetDeliveryFiles: string[];
    targetGovernanceFiles: string[];
    planningFiles: string[];
    excludedDirtyFiles: string[];
    excludedReasons: Record<string, string>;
    scopeAmendment: TaskflowScopeAmendmentProposal;
}
export interface TaskflowDeliveryCommit {
    repoRoot: string;
    stageFiles: string[];
    commitMessage: string;
    commitSha: string | null;
    status: 'committed';
}
export interface DeferredGovernanceDirtyFile {
    file: string;
    snapshotPath: string;
    originalSha256: string;
    restoredAt: string | null;
}
export interface DeferredGovernanceDirtyReport {
    schemaId: 'atm.deferredGovernanceDirty.v1';
    requested: boolean;
    files: DeferredGovernanceDirtyFile[];
    restored: boolean;
}
export declare function readStagedFiles(repoRoot: string): string[];
export declare function isDeferrableGovernanceDirtyFile(filePath: string): boolean;
export declare function deferGovernanceDirtyFiles(repoRoot: string, requested: boolean): DeferredGovernanceDirtyReport;
export declare function restoreDeferredGovernanceDirtyFiles(repoRoot: string, report: DeferredGovernanceDirtyReport): DeferredGovernanceDirtyReport;
export declare function buildTaskflowCommitBundle(input: {
    cwd: string;
    taskId: string;
    actorId: string | null;
    commitMode: TaskflowCommitMode;
    planningMirrorPath: string | null;
    rosterIndexPath: string | null;
    extraPlanningStageFiles?: readonly string[];
    backendResult?: Record<string, unknown> | null;
    historicalDeliveryRefs?: string[];
    historicalBatchRef?: string | null;
    planningAuthorityDeliveryOk?: boolean;
}): TaskflowGovernedCommitBundle;
export declare function assertCommitBundleReady(bundle: TaskflowGovernedCommitBundle): void;
export declare function commitTaskflowDeliveryFiles(input: {
    bundle: TaskflowGovernedCommitBundle;
    actorId: string;
    taskId: string;
    deferForeignStaged?: boolean;
}): Promise<TaskflowDeliveryCommit | null>;
export declare function finalizeTaskflowCommitBundle(input: {
    bundle: TaskflowGovernedCommitBundle;
    actorId: string;
    taskId: string;
}): Promise<TaskflowGovernedCommitBundle>;
