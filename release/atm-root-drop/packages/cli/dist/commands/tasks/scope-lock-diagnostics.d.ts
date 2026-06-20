export interface TaskCloseScopedDiffIsolationReport {
    readonly schemaId: 'atm.taskCloseScopedDiffIsolation.v1';
    readonly taskId: string;
    readonly declaredFiles: readonly string[];
    readonly scopedCriticalChangedFiles: readonly string[];
    readonly isolatedUnrelatedChanges: readonly string[];
    readonly declaredButUnchanged: readonly string[];
    readonly summary: TaskScopeIsolationSummary;
    readonly advisoryNote: string;
    readonly blockingTrackedDirtyFiles?: readonly string[];
    readonly scopeTrackedDirtyFiles?: readonly string[];
    readonly governanceTrackedDirtyFiles?: readonly string[];
    readonly advisoryTrackedDirtyFiles?: readonly string[];
    readonly generatedArtifactFiles?: readonly string[];
    readonly ignoredUntrackedFiles?: readonly string[];
    readonly remediation?: TaskScopeDiagnosticRemediation;
}
export interface FrameworkCloseDirtyGuardReport {
    readonly schemaId: 'atm.frameworkCloseDirtyGuard.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly reason: 'no-blocking-dirty-files' | 'blocking-dirty-files-present';
    readonly blockingTrackedDirtyFiles: readonly string[];
    readonly scopeTrackedDirtyFiles: readonly string[];
    readonly governanceTrackedDirtyFiles: readonly string[];
    readonly regenerableArtifactFiles: readonly string[];
    readonly correctPlanningMirrorPreEditFiles: readonly string[];
    readonly incorrectPlanningMirrorPreEditFiles: readonly string[];
    readonly advisoryTrackedDirtyFiles: readonly string[];
    readonly foreignActiveDirtyFiles: readonly string[];
    readonly generatedArtifactFiles: readonly string[];
    readonly remediation: TaskScopeDiagnosticRemediation;
}
export interface TaskScopeDiagnosticRemediation {
    readonly requiredCommand: string | null;
    readonly safeToAutoStage: false;
    readonly operatorSummary: string;
}
type TaskScopeIsolationSummary = 'no-isolation-required' | 'all-critical-changes-isolated-as-advisory' | 'mixed-in-scope-and-isolated-changes';
export declare function buildCloseScopedDiffIsolation(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskDeclaredFiles: readonly string[];
    readonly frameworkChangedFiles: readonly string[];
    readonly frameworkDeliveryWindow: {
        readonly scopedCriticalChangedFiles: readonly string[];
        readonly unscopedCriticalChangedFiles: readonly string[];
        readonly declaredFiles: readonly string[];
    };
}): TaskCloseScopedDiffIsolationReport;
export declare function evaluateFrameworkCloseDirtyGuard(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskDeclaredFiles: readonly string[];
    readonly taskDeliverableFiles?: readonly string[];
    readonly trackedDirtyFiles: readonly string[];
    readonly historicalDeliveredFiles?: readonly string[];
    readonly allowedAdvisoryGovernanceFiles?: readonly string[];
    readonly allowedAdvisoryDirtyFiles?: readonly string[];
    readonly correctPlanningMirrorPreEditFiles?: readonly string[];
    readonly incorrectPlanningMirrorPreEditFiles?: readonly string[];
}): FrameworkCloseDirtyGuardReport;
export declare function summarizeCloseWindowLockRemediation(input: {
    cwd: string;
    taskId: string;
    actorId: string;
}): TaskScopeDiagnosticRemediation;
export declare function attachDirtyGuardToScopedDiffIsolation(isolation: TaskCloseScopedDiffIsolationReport | null, dirtyGuard: FrameworkCloseDirtyGuardReport, ignoredUntrackedFiles: readonly string[]): TaskCloseScopedDiffIsolationReport | null;
export {};
