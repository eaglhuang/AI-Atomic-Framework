export { assertClosebackPlanningPathReady, buildCloseBackendArgv, buildClosebackPlan, buildCloseWriteRollbackSnapshot, buildTaskflowCloseDiagnostics, executeCloseWriteCommitPhase, listOptionalEvidenceBundleGovernanceArtifacts, resolveCloseWriteSupport, resolveClosebackPlanningPath, type ClosebackPlanningPathResolution, type TaskScopeAmendmentSummary, type TaskflowClosebackPlan } from './close-orchestration.ts';
export interface PlanningCardCloseback {
    mode: 'frontmatter-closeback' | 'frontmatter-pre-edit-absorbed';
    repoRoot: string;
    relativePath: string;
    transitionPath: string | null;
    updatedFields: string[];
}
export declare function capturePlanningCardSnapshot(input: {
    cwd: string;
    planningMirrorPath: string | null;
}): {
    absolutePath: string;
    previousContent: string;
} | null;
export declare function applyPlanningCardCloseback(input: {
    cwd: string;
    planningMirrorPath: string | null;
    actorId: string;
    historicalDeliveryRefs: string[];
}): PlanningCardCloseback | null;
export declare function resolvePlanningRosterPaths(input: {
    cwd: string;
    planningMirrorPath: string | null;
    rosterIndexPath: string | null;
}): {
    repoRoot: string | null;
    fromPath: string | null;
    indexPath: string | null;
    reason: string | null;
};
