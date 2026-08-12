import { type TaskClaimDependencyBlocker } from '../tasks/public-surface.ts';
export type NextClaimIntent = 'write' | 'closeout-only';
export interface ClaimReadinessTaskSummary {
    readonly workItemId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly sourcePlanPath: string | null;
    readonly scopePaths?: readonly string[];
    readonly targetAllowedFiles?: readonly string[];
    readonly activeClaimActorId?: string | null;
}
export interface ClaimReadinessDiagnostic {
    readonly taskId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly claimable: boolean;
    readonly blockerCode: string;
    readonly blockerSummary: string;
    readonly requiredCommand: string | null;
    readonly dependencyBlockers: readonly TaskClaimDependencyBlocker[];
}
export interface ClaimReadinessReport {
    readonly schemaId: 'atm.claimReadinessReport.v1';
    readonly diagnostics: readonly ClaimReadinessDiagnostic[];
    readonly primaryBlocker: ClaimReadinessDiagnostic | null;
}
export declare function extractClaimIntentFlag(argv: readonly string[]): {
    argv: string[];
    claimIntent: NextClaimIntent | null;
    autoIntent: boolean;
};
export declare function diagnoseClaimReadinessForTasks(cwd: string, tasks: readonly ClaimReadinessTaskSummary[], claimIntent: NextClaimIntent, options?: {
    readonly dependencyMode?: 'claim-files' | 'hard';
}): ClaimReadinessReport;
