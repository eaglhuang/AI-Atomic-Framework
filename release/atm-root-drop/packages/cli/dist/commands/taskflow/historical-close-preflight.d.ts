import { type FrameworkCloseDirtyGuardReport } from '../tasks/scope-lock-diagnostics.ts';
import { type TaskHistoricalDeliveryReport } from '../tasks/historical-delivery.ts';
interface PreflightCommitRepoBundle {
    readonly repoRoot: string | null;
    readonly stageFiles: readonly string[];
}
interface PreflightCommitBundle {
    readonly targetRepo: PreflightCommitRepoBundle;
    readonly planningRepo: PreflightCommitRepoBundle;
}
export type HistoricalClosePreflightBlockerId = 'scopeTrackedDirtyFiles' | 'incorrectPlanningMirrorPreEdit' | 'unexpectedStagedTasks' | 'unexpectedStagedNonBundleFiles' | 'mixedDeliveryCommit' | 'staleEvidence' | 'missingApprovalLease';
export interface HistoricalClosePreflightRemediationChoice {
    readonly id: 'restore-accidental-drift' | 'commit-scoped-delivery' | 'defer-foreign-staged' | 'request-waiver' | 'refresh-evidence' | 'restore-accidental-staged';
    readonly summary: string;
    readonly requiredCommand: string | null;
}
export interface HistoricalClosePreflightBlocker {
    readonly id: HistoricalClosePreflightBlockerId;
    readonly code: string;
    readonly summary: string;
    readonly files?: readonly string[];
    readonly taskIds?: readonly string[];
    readonly remediationChoices: readonly HistoricalClosePreflightRemediationChoice[];
    readonly requiredCommand: string | null;
}
export interface UnexpectedStagedTaskReport {
    readonly taskId: string;
    readonly stagedFiles: readonly string[];
    readonly restoreChoice: string;
    readonly deferCommand: string;
}
export interface UnexpectedNonBundleStagedRepoReport {
    readonly repoRoot: string;
    readonly repoKind: 'target' | 'planning';
    readonly stagedFiles: readonly string[];
    readonly restoreCommand: string;
    readonly deferredForeignFiles: readonly string[];
}
export interface HistoricalCloseWriteRollbackSummary {
    readonly schemaId: 'atm.historicalCloseWriteRollbackSummary.v1';
    readonly summary: string;
    readonly operatorWarnings: readonly string[];
    readonly verificationCommands: readonly string[];
}
export interface HistoricalClosePreflightSummary {
    readonly schemaId: 'atm.historicalClosePreflight.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly blockers: readonly HistoricalClosePreflightBlocker[];
    readonly operationalBlockers: readonly HistoricalClosePreflightBlocker[];
    readonly scopeTrackedDirtyFiles: readonly string[];
    readonly unexpectedStagedTasks: readonly UnexpectedStagedTaskReport[];
    readonly unexpectedNonBundleStaged: readonly UnexpectedNonBundleStagedRepoReport[];
    readonly mixedDeliveryCommit: TaskHistoricalDeliveryReport | null;
    readonly staleEvidence: readonly string[];
    readonly missingApprovalLease: boolean;
    readonly dirtyGuard: FrameworkCloseDirtyGuardReport;
    readonly writeRollbackSummary: HistoricalCloseWriteRollbackSummary;
}
export declare function extractTaskflowDeclaredFiles(taskDocument: Record<string, unknown>): string[];
export declare function buildHistoricalClosePreflight(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    taskDocument: Record<string, unknown>;
    previewCommitBundle: PreflightCommitBundle;
    historicalDeliveryRefs: readonly string[];
    waiverOutOfScopeDelivery: boolean;
    waiverReason: string | null;
}): HistoricalClosePreflightSummary;
export declare function preflightBlockersToWriteReadinessBlockers(preflight: HistoricalClosePreflightSummary): Array<{
    code: string;
    summary: string;
    requiredCommand: string | null;
}>;
export {};
