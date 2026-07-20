import type { GovernanceAdapter } from '@ai-atomic-framework/plugin-sdk';
import type { LocalGovernanceConfig } from './bootstrap/types.ts';
export { resolveLocalGovernanceLayout } from './layout.ts';
export { createLocalGovernanceStores } from './stores.ts';
export { createDefaultGuards, defaultGuardCatalog } from './default-guards.ts';
export type { LocalGovernanceConfig, LocalGovernanceBootstrapOptions, LocalGovernanceBootstrapResult, LocalGovernancePinnedRunnerResult, LocalGovernanceScriptInstallResult, ContinuationContractInput } from './bootstrap/types.ts';
export { adoptLocalGovernanceBundle, installRootDropScripts, createOfficialBootstrapCommand, createRecommendedPrompt, createSelfHostingAlphaPrompt } from './bootstrap/bootstrap.ts';
export { estimateContextBudgetTokens, createDefaultContextBudgetPolicy, evaluateContextBudget, createContextBudgetSummary, sanitizeBudgetFileId } from './bootstrap/budget.ts';
export { createContinuationSummaryRecord, createContinuationRunReport, renderContextSummaryMarkdown } from './bootstrap/prompt.ts';
export declare const pluginGovernanceLocalPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-governance-local";
    readonly packageRole: "local-governance-reference-plugins";
    readonly packageVersion: "0.0.0";
};
export declare function createLocalGovernanceAdapter(config: LocalGovernanceConfig): GovernanceAdapter;
export * from './versioning.ts';
