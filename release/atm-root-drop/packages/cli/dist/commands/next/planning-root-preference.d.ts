import { type Dirent } from 'node:fs';
export declare const PLANNING_ROOT_RELATIVE_SUFFIX: string;
export interface PlanningRootWarning {
    readonly code: 'ATM_PLANNING_ROOT_AMBIGUOUS';
    readonly detail: string;
    readonly siblingRepoDirs: readonly string[];
}
export interface PlanningRootResolution {
    readonly roots: readonly string[];
    readonly excludedDerivativeRoots: readonly string[];
    readonly ambiguousSiblingGroups: readonly (readonly string[])[];
    readonly warnings: readonly PlanningRootWarning[];
}
export declare function isDerivativeSiblingRepoName(canonicalName: string, candidateName: string): boolean;
export declare function repoDirFromPlanningRoot(planningRoot: string): string | null;
export declare function repoDirNameFromPlanningRoot(planningRoot: string): string | null;
export declare function applyCanonicalSiblingPreference(planningRoots: readonly string[], parentDir: string): PlanningRootResolution;
export declare function resolveCandidatePlanningRoots(cwd: string, options?: {
    readonly configuredRoots?: readonly string[];
    readonly readDir?: (directoryPath: string) => readonly Dirent[];
    readonly exists?: (filePath: string) => boolean;
}): PlanningRootResolution;
export declare function listCandidatePlanningRoots(cwd: string): readonly string[];
export declare function isExcludedDerivativePlanningRoot(taskPath: string, cwd: string, resolution: PlanningRootResolution): boolean;
export declare function isCanonicalPreferredPlanningRoot(taskPath: string, cwd: string): boolean;
