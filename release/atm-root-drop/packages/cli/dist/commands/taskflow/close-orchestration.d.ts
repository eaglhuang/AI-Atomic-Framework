import type { TaskflowDelegationContract, TaskflowProfileV1 } from './profile-loader.ts';
import type { TaskResidueBucket, TaskResidueClassification } from '../tasks/public-surface.ts';
import { type TaskflowCloseBackend, type TaskflowCloseMode } from '../tasks/surface-invariants.ts';
export type ClosebackPlanningPathRoute = 'source-plan-path' | 'profile-root-fallback' | 'missing' | 'ambiguous';
export interface ClosebackPlanningPathResolution {
    route: ClosebackPlanningPathRoute;
    planningMirrorPath: string | null;
    profileRepoRoot: string | null;
    planningStatus: string | null;
    diagnostics: {
        codes: string[];
        messages: string[];
    };
}
export type { TaskflowCloseBackend, TaskflowCloseMode };
/** closeback 摘要中暴露的單筆範圍增修紀錄，讓 reviewer 在收口時區分正常 linked-surface 成長與可疑 scope drift。 */
export interface TaskScopeAmendmentSummary {
    transitionId: string;
    actorId: string | null;
    createdAt: string;
    addedPaths: string[];
    amendmentClass: string | null;
    amendmentPhase: string | null;
    amendmentMode: 'normal' | 'repair' | null;
    reason: string | null;
}
export interface TaskflowClosebackPlan {
    closeMode: TaskflowCloseMode;
    backendSurface: TaskflowCloseBackend;
    backendCommand: string;
    followUpSteps: string[];
    writerBoundary: {
        adopterAware: true;
        planningMirrorPath: string | null;
        writerSurface: 'planning-mirror-adopter-flow';
        generationSurface: 'tasks-new';
        rosterSyncPolicy: 'inline' | 'follow-up-command' | 'none';
        rosterIndexPath: string | null;
        rosterClosebackCommand: string | null;
        closebackNote: string;
    };
    historicalDeliveryGate: {
        required: boolean;
        refs: string[];
        validatorSurfaces: string[];
    };
    planningAuthorityDeliveryGate: {
        required: boolean;
        ok: boolean;
        repoRoot: string | null;
        matchedFiles: string[];
        reason: string | null;
    };
    evidenceValidators: string[];
    residue: Pick<TaskResidueClassification, 'bucket' | 'truth' | 'residue' | 'reason' | 'nextCommand'>;
    /** 該任務已記錄的範圍增修歷史（依時間順序），收口摘要中可見。 */
    amendmentHistory: TaskScopeAmendmentSummary[];
    closebackPathResolution?: ClosebackPlanningPathResolution;
}
export declare function buildClosebackPlan(input: {
    taskId: string;
    actorId: string;
    historicalDeliveryRefs: string[];
    historicalBatchRef?: string | null;
    planningAuthorityDeliveryGate?: {
        required: boolean;
        ok: boolean;
        repoRoot: string | null;
        matchedFiles: string[];
        reason: string | null;
    };
    waiverOutOfScopeDelivery?: boolean;
    waiverReason?: string | null;
    delegationContract: TaskflowDelegationContract;
    diagnosis: {
        bucket: TaskResidueBucket;
        truth: string;
        residue: string;
        reason: string;
        nextCommand: string;
        triangulation: {
            liveLedger: {
                status: string | null;
            };
            planningFrontmatter: {
                status: string | null;
                source: string | null;
            };
            divergence: Array<{
                field: string;
            }>;
            amendmentHistory?: ReadonlyArray<TaskScopeAmendmentSummary>;
        };
    };
    closebackPathResolution?: ClosebackPlanningPathResolution;
}): TaskflowClosebackPlan;
export declare function buildTaskflowCloseDiagnostics(input: {
    closeMode: TaskflowCloseMode;
    writeRequested: boolean;
    actorSupplied: boolean;
    taskIdSupplied: boolean;
}): {
    codes: string[];
    messages: string[];
    missingPrerequisites: string[];
};
export declare function buildCloseBackendArgv(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    backendSurface: TaskflowCloseBackend;
    historicalDeliveryRefs: string[];
    historicalBatchRef?: string | null;
    historicalDeliveryRepo?: string | null;
    waiverOutOfScopeDelivery?: boolean;
    waiverReason?: string | null;
    planningMirrorPath: string | null;
    forceImport: boolean;
}): string[];
export declare function resolveClosebackPlanningPath(input: {
    cwd: string;
    taskId: string;
    taskDocument: Record<string, unknown>;
    profile: TaskflowProfileV1 | null;
    profileRepoRoot: string | null;
    delegationContract: TaskflowDelegationContract;
}): ClosebackPlanningPathResolution;
export declare function assertClosebackPlanningPathReady(resolution: ClosebackPlanningPathResolution, input: {
    profileSupplied: boolean;
    requirePlanningPath: boolean;
}): void;
export declare function resolveCloseWriteSupport(input: {
    writeRequested: boolean;
    closeMode: TaskflowCloseMode;
    actorSupplied: boolean;
    taskIdSupplied: boolean;
    historicalDeliveryGateRequired: boolean;
    historicalDeliverySupplied: boolean;
}): {
    requested: boolean;
    allowed: boolean;
    reason: string;
};
