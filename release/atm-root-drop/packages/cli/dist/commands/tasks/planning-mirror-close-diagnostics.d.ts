export interface PlanningMirrorClosebackExpectation {
    readonly status: 'done';
    readonly completedByActor: string;
    readonly deliveryCommit: string | null;
}
export type PlanningMirrorPreEditClassification = 'correct-pre-edit' | 'incorrect-pre-edit' | 'not-applicable';
export interface PlanningMirrorDirtyEvaluation {
    readonly correctPlanningMirrorPreEditFiles: readonly string[];
    readonly incorrectPlanningMirrorPreEditFiles: readonly string[];
    readonly remediation: string | null;
}
export declare function buildPlanningMirrorClosebackExpectation(actorId: string, historicalDeliveryRef: string | null): PlanningMirrorClosebackExpectation;
export declare function classifyPlanningMirrorPreEdit(input: {
    readonly relativePath: string;
    readonly fileContent: string;
    readonly expectation: PlanningMirrorClosebackExpectation;
}): PlanningMirrorPreEditClassification;
export declare function evaluatePlanningMirrorDirtyFiles(input: {
    readonly planningRepoRoot: string | null;
    readonly planningMirrorRelativePath: string | null;
    readonly trackedDirtyFiles: readonly string[];
    readonly actorId: string;
    readonly historicalDeliveryRef: string | null;
}): PlanningMirrorDirtyEvaluation;
