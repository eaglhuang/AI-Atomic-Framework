import type { GovernanceAdapter } from '@ai-atomic-framework/plugin-sdk';
import type { LocalGovernanceConfig } from './bootstrap/types.js';
export { resolveLocalGovernanceLayout } from './layout.js';
export { createLocalGovernanceStores } from './stores.js';
export { createDefaultGuards, defaultGuardCatalog } from './default-guards.js';
export type { LocalGovernanceConfig, LocalGovernanceBootstrapOptions, LocalGovernanceBootstrapResult, LocalGovernancePinnedRunnerResult, LocalGovernanceScriptInstallResult, ContinuationContractInput } from './bootstrap/types.js';
export { adoptLocalGovernanceBundle, installRootDropScripts, createOfficialBootstrapCommand, createRecommendedPrompt, createSelfHostingAlphaPrompt } from './bootstrap/bootstrap.js';
export { estimateContextBudgetTokens, createDefaultContextBudgetPolicy, evaluateContextBudget, createContextBudgetSummary, sanitizeBudgetFileId } from './bootstrap/budget.js';
export { createContinuationSummaryRecord, createContinuationRunReport, renderContextSummaryMarkdown } from './bootstrap/prompt.js';
export declare const pluginGovernanceLocalPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-governance-local";
    readonly packageRole: "local-governance-reference-plugins";
    readonly packageVersion: "0.0.0";
};
export declare function createLocalGovernanceAdapter(config: LocalGovernanceConfig): GovernanceAdapter;
export * from './versioning.js';
