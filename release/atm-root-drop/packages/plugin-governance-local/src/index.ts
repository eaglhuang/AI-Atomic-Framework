import type { GovernanceAdapter } from '@ai-atomic-framework/plugin-sdk';
import { resolveLocalGovernanceLayout } from './layout.ts';
import { createLocalGovernanceStores } from './stores.ts';
import type { LocalGovernanceConfig } from './bootstrap/types.ts';

export { resolveLocalGovernanceLayout } from './layout.ts';
export { createLocalGovernanceStores } from './stores.ts';
export { createDefaultGuards, defaultGuardCatalog } from './default-guards.ts';

export type {
  LocalGovernanceConfig,
  LocalGovernanceBootstrapOptions,
  LocalGovernanceBootstrapResult,
  LocalGovernancePinnedRunnerResult,
  LocalGovernanceScriptInstallResult,
  ContinuationContractInput
} from './bootstrap/types.ts';

export {
  adoptLocalGovernanceBundle,
  installRootDropScripts,
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt
} from './bootstrap/bootstrap.ts';

export {
  estimateContextBudgetTokens,
  createDefaultContextBudgetPolicy,
  evaluateContextBudget,
  createContextBudgetSummary,
  sanitizeBudgetFileId
} from './bootstrap/budget.ts';

export {
  createContinuationSummaryRecord,
  createContinuationRunReport,
  renderContextSummaryMarkdown
} from './bootstrap/prompt.ts';

export const pluginGovernanceLocalPackage = {
  packageName: '@ai-atomic-framework/plugin-governance-local',
  packageRole: 'local-governance-reference-plugins',
  packageVersion: '0.0.0'
} as const;

export function createLocalGovernanceAdapter(config: LocalGovernanceConfig): GovernanceAdapter {
  const layout = resolveLocalGovernanceLayout(config.layout);
  return {
    adapterName: '@ai-atomic-framework/plugin-governance-local',
    layout,
    stores: createLocalGovernanceStores({ ...config, layout })
  };
}

// Export versioning helpers (Slice 1 & TASK-AAO-0071 hygiene rename)
export * from './versioning.ts';
