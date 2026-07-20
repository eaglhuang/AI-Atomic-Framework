export interface PlanningRootAuthorshipFinding {
    readonly taskId: string;
    readonly expectedCardHint: string;
    readonly foundCardPath: string | null;
}
export interface PlanningRootAuthorshipReport {
    readonly schemaId: 'atm.planningRootAuthorship.v1';
    readonly applies: boolean;
    readonly ok: boolean;
    readonly waived: boolean;
    readonly code: 'ATM_TASKS_IMPORT_PLANNING_ROOT_REQUIRED' | null;
    readonly detail: string | null;
    readonly planPath: string;
    readonly planningRootsChecked: readonly string[];
    readonly missingTaskIds: readonly string[];
    readonly findings: readonly PlanningRootAuthorshipFinding[];
    readonly requiredCommand: string | null;
    readonly waiveCommand: string | null;
}
export declare function isTargetTaskPlanPath(planRelativePath: string): boolean;
export declare function isPlanningFamilyTaskId(taskId: string): boolean;
export declare function findPlanningRootTaskCard(input: {
    readonly planningRoots: readonly string[];
    readonly taskId: string;
}): string | null;
export declare function inspectPlanningRootAuthorship(input: {
    readonly cwd: string;
    readonly planAbsolute: string;
    readonly planRelativePath: string;
    readonly taskIds: readonly string[];
    readonly waivePlanningRoot?: boolean;
    readonly isFrameworkRepo?: boolean;
    readonly planningRoots?: readonly string[];
}): PlanningRootAuthorshipReport;
