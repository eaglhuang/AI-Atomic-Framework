import type { ContextSummaryRecord } from '@ai-atomic-framework/core';
import type { GovernanceLayout } from '@ai-atomic-framework/plugin-sdk';
export interface LocalGovernanceConfig {
    readonly repositoryRoot: string;
    readonly layout?: Partial<GovernanceLayout>;
    readonly now?: () => string;
}
export interface LocalGovernanceBootstrapOptions {
    readonly force?: boolean;
    readonly taskId?: string;
    readonly taskTitle?: string;
}
export interface LocalGovernanceBootstrapResult {
    readonly created: readonly string[];
    readonly unchanged: readonly string[];
    readonly pinnedRunner: LocalGovernancePinnedRunnerResult;
    readonly adoptedProfile: 'default';
    readonly bootstrapTaskPath: string;
    readonly bootstrapLockPath: string;
    readonly agentInstructionsPath: string;
    readonly profilePath: string;
    readonly projectProbePath: string;
    readonly defaultGuardsPath: string;
    readonly evidencePath: string;
    readonly contextBudgetPolicyPath: string;
    readonly contextBudgetReportPath: string;
    readonly contextBudgetSummaryPath?: string;
    readonly contextSummaryPath: string;
    readonly contextSummaryMarkdownPath: string;
    readonly continuationReportPath: string;
    readonly projectProbe: Readonly<Record<string, unknown>>;
    readonly recommendedPrompt: string;
    readonly charterPath: string;
    readonly charterInvariantsPath: string;
    readonly scriptPaths: readonly string[];
}
export interface LocalGovernancePinnedRunnerResult {
    readonly schemaVersion: 'atm.pinnedRunner.v0.1';
    readonly runnerPath: 'atm.mjs';
    readonly metadataPath: '.atm/runtime/pinned-runner.json';
    readonly command: 'node atm.mjs next --prompt "<current user prompt>" --json';
    readonly status: 'installed' | 'replaced' | 'unchanged' | 'skipped-existing-different' | 'source-unavailable';
    readonly sourceKind: 'explicit-env' | 'onefile-launcher' | 'release-onefile' | 'unavailable';
    readonly sourcePath?: string;
    readonly sha256?: string;
    readonly existingSha256?: string;
    readonly sizeBytes?: number;
    readonly frameworkVersion: string;
    readonly generatedAt: string;
    readonly reason?: string;
}
export interface LocalGovernanceScriptInstallResult {
    readonly created: readonly string[];
    readonly unchanged: readonly string[];
    readonly scriptPaths: readonly string[];
    readonly platformHintPath: string;
}
export interface ContinuationContractInput {
    readonly workItemId: string;
    readonly generatedAt: string;
    readonly summaryId?: string;
    readonly summary: string;
    readonly nextActions: readonly string[];
    readonly artifactPaths?: readonly string[];
    readonly evidencePaths?: readonly string[];
    readonly reportPaths?: readonly string[];
    readonly authoredBy?: string;
    readonly handoffKind?: ContextSummaryRecord['handoffKind'];
    readonly continuationGoal?: string;
    readonly resumePrompt?: string;
    readonly resumeCommand?: readonly string[];
    readonly budgetDecision?: ContextSummaryRecord['budgetDecision'];
    readonly hardStop?: boolean;
}
