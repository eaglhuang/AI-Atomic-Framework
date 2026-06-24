import { type PlanningRootResolution } from './next/planning-root-preference.ts';
export declare const PLANNING_REPO_ROOT_ENV = "ATM_PLANNING_REPO_ROOT";
export interface PlanningRepoRootConfig {
    readonly envRoot: string | null;
    readonly configRoots: readonly string[];
    readonly resolvedConfigRoots: readonly string[];
    readonly candidateResolution: PlanningRootResolution;
    readonly effectiveRoots: readonly string[];
}
export interface StoredPlanningPathResolution {
    readonly storedPath: string;
    readonly absolutePath: string;
    readonly planningRoot: string | null;
    readonly planningRelativePath: string | null;
    readonly isExternalPlanning: boolean;
}
export interface PlanningRootMissingDiagnostic {
    readonly code: 'ATM_PLANNING_ROOT_MISSING';
    readonly detail: string;
    readonly suggestedEnv: string;
    readonly suggestedConfig: Record<string, unknown>;
    readonly requiredCommand: string;
}
export declare function isPlanningRootDocStoredPath(storedPath: string): boolean;
export declare function looksLikePlanningRootRelativePath(storedPath: string): boolean;
export declare function readPlanningRootEnv(): string | null;
export declare function readConfiguredPlanningRoots(cwd: string): readonly string[];
export declare function resolvePlanningRepoRootConfig(cwd: string): PlanningRepoRootConfig;
export declare function toStoredPlanningPath(cwd: string, absolutePath: string): string;
export declare function resolveStoredPlanningPath(cwd: string, storedPath: string): StoredPlanningPathResolution;
export declare function isExternalPlanningStoredPath(cwd: string, storedPath: string): boolean;
export declare function normalizeStoredPlanningPathForIdentity(cwd: string, storedPath: string): string;
export declare function resolvePlanningPathFromStored(cwd: string, storedPath: string | null): {
    readonly repoRoot: string | null;
    readonly relativePath: string | null;
    readonly reason: string | null;
};
export declare function resolvePlanAbsoluteFromStored(cwd: string, storedPath: string): string;
export declare function buildPlanningRootMissingDiagnostic(cwd: string): PlanningRootMissingDiagnostic;
export declare function shouldReportPlanningRootMissing(input: {
    readonly cwd: string;
    readonly taskScopeMentioned: boolean;
    readonly mentionedPlanPaths: readonly string[];
    readonly userPrompt: string | null;
    readonly matchedTaskCount: number;
}): PlanningRootMissingDiagnostic | null;
