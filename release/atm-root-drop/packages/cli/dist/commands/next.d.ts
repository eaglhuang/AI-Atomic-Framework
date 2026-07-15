import { type TaskClaimDependencyBlocker } from './tasks/public-surface.ts';
export { resolvePromptScopedTaskContext, resolveHandoffResumeTaskRoute, shouldSkipExternalTaskCardScan, shouldSkipMarkdownTaskDiscovery, type PromptScopedTaskContext } from './next/route-resolution.ts';
export { buildActiveWorkSummary } from './next/playbook-projection.ts';
export type NextCommandResult = {
    readonly ok?: boolean;
    readonly command?: string;
    readonly cwd?: string;
    readonly messages: Array<Record<string, any>>;
    readonly evidence: Record<string, any>;
    readonly [key: string]: any;
};
export declare function runNext(argv: string[]): Promise<NextCommandResult>;
export type NextClaimIntent = 'write' | 'closeout-only';
export interface ClaimReadinessTaskSummary {
    readonly workItemId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly sourcePlanPath: string | null;
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
export declare function diagnoseClaimReadinessForTasks(cwd: string, tasks: readonly ClaimReadinessTaskSummary[], claimIntent: NextClaimIntent): ClaimReadinessReport;
