import { resolveLocalGovernanceLayout } from './layout.js';
import { createLocalGovernanceStores } from './stores.js';
export { resolveLocalGovernanceLayout } from './layout.js';
export { createLocalGovernanceStores } from './stores.js';
export { createDefaultGuards, defaultGuardCatalog } from './default-guards.js';
export { adoptLocalGovernanceBundle, installRootDropScripts, createOfficialBootstrapCommand, createRecommendedPrompt, createSelfHostingAlphaPrompt } from './bootstrap/bootstrap.js';
export { estimateContextBudgetTokens, createDefaultContextBudgetPolicy, evaluateContextBudget, createContextBudgetSummary, sanitizeBudgetFileId } from './bootstrap/budget.js';
export { createContinuationSummaryRecord, createContinuationRunReport, renderContextSummaryMarkdown } from './bootstrap/prompt.js';
export const pluginGovernanceLocalPackage = {
    packageName: '@ai-atomic-framework/plugin-governance-local',
    packageRole: 'local-governance-reference-plugins',
    packageVersion: '0.0.0'
};
export function createLocalGovernanceAdapter(config) {
    const layout = resolveLocalGovernanceLayout(config.layout);
    return {
        adapterName: '@ai-atomic-framework/plugin-governance-local',
        layout,
        stores: createLocalGovernanceStores({ ...config, layout })
    };
}
// Export versioning helpers (Slice 1 & TASK-AAO-0071 hygiene rename)
export * from './versioning.js';
