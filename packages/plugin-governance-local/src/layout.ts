import type { GovernanceLayout } from '@ai-atomic-framework/plugin-sdk';

export const defaultLocalGovernanceLayout: GovernanceLayout = {
  root: '.atm',
  taskStorePath: '.atm/history/tasks',
  lockStorePath: '.atm/runtime/locks',
  documentIndexPath: '.atm/catalog/index',
  shardStorePath: '.atm/catalog/shards',
  stateStorePath: '.atm/runtime/state',
  artifactStorePath: '.atm/history/artifacts',
  logStorePath: '.atm/history/logs',
  runReportStorePath: '.atm/history/reports',
  ruleGuardPath: '.atm/runtime/rules',
  evidenceStorePath: '.atm/history/evidence',
  registryStorePath: '.atm/catalog/registry',
  contextBudgetStorePath: '.atm/runtime/budget',
  contextSummaryStorePath: '.atm/history/handoff'
};

export function resolveLocalGovernanceLayout(layout: Partial<GovernanceLayout> = {}): GovernanceLayout {
  return {
    ...defaultLocalGovernanceLayout,
    ...layout
  };
}
