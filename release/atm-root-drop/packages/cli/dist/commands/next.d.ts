import { type TaskClaimDependencyBlocker } from './tasks/public-surface.ts';
import { type TaskIntentSource, type RequestedTaskAction, type TaskIntent } from './next/intent-normalizers.ts';
import { type ImportedTaskSummary, type PromptScopedRouteStatus } from './next/route-predicates.ts';
export declare function runNext(argv: any): Promise<import("./shared.ts").CommandResult>;
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
export interface PromptScopedTaskContext {
    readonly taskIntent: {
        readonly userPrompt: string | null;
        readonly explicitTaskIds: readonly string[];
        readonly taskScopeMentioned: boolean;
        readonly requestedAction: RequestedTaskAction | null;
        readonly source: TaskIntentSource;
    } | null;
    readonly promptScope: {
        readonly status: PromptScopedRouteStatus;
        readonly selectedTasks: readonly ImportedTaskSummary[];
        readonly targetRepo: string | null;
        readonly diagnostics: readonly string[];
    } | null;
}
export declare function shouldSkipExternalTaskCardScan(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function shouldSkipMarkdownTaskDiscovery(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function resolvePromptScopedTaskContext(cwd: string, input: {
    readonly prompt?: string | null;
    readonly intentPath?: string | null;
}): PromptScopedTaskContext;
