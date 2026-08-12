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
export { diagnoseClaimReadinessForTasks, type ClaimReadinessDiagnostic, type ClaimReadinessReport, type ClaimReadinessTaskSummary, type NextClaimIntent } from './next/claim-orchestration.ts';
