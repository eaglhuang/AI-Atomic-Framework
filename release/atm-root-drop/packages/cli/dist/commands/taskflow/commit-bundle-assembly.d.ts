import { type GitIndexLeaseParkPlan } from '../git-index-ownership.ts';
export type TaskflowCommitMode = 'auto-commit' | 'stage-only' | 'dry-run';
export interface TaskflowIndexIsolation {
    verified: boolean;
    expectedStageFiles: string[];
    preStagedFiles: string[];
    unexpectedStagedFiles: string[];
    indexLease: GitIndexLeaseParkPlan;
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
export interface TaskflowSealAndCommitReceipt {
    schemaId: 'atm.taskflowSealAndCommitReceipt.v1';
    taskId: string;
    actorId: string | null;
    createdAt: string;
    targetHeadBeforeCommit: string | null;
    planningHeadBeforeCommit: string | null;
    historicalDeliveryRefs: string[];
    historicalBatchRef: string | null;
    manifestPath: string;
    targetPayloadDigest: string;
    targetEvidenceDigest: string;
    planningPayloadDigest: string;
    planningEvidenceDigest: string;
    sealDigest: string;
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
    sealAndCommitReceipt: TaskflowSealAndCommitReceipt;
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
    skipReason?: 'snapshot-missing' | null;
}
export interface DeferredGovernanceDirtyReport {
    schemaId: 'atm.deferredGovernanceDirty.v1';
    requested: boolean;
    files: DeferredGovernanceDirtyFile[];
    restored: boolean;
    skippedMissingSnapshots?: readonly string[];
}
export declare function readStagedFiles(repoRoot: string): string[];
export declare function isDeferrableGovernanceDirtyFile(filePath: string, taskId?: string | null): boolean;
export declare function deferGovernanceDirtyFiles(repoRoot: string, requested: boolean, taskId?: string | null): DeferredGovernanceDirtyReport;
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
