import type { GovernanceStores } from './stores';

export interface GovernanceLayout {
  readonly root: string;
  readonly taskStorePath: string;
  readonly lockStorePath: string;
  readonly documentIndexPath: string;
  readonly shardStorePath: string;
  readonly stateStorePath: string;
  readonly artifactStorePath: string;
  readonly logStorePath: string;
  readonly runReportStorePath: string;
  readonly ruleGuardPath: string;
  readonly evidenceStorePath: string;
  readonly registryStorePath?: string;
  readonly contextBudgetStorePath?: string;
  readonly contextSummaryStorePath?: string;
}

export const defaultGovernanceLayout: GovernanceLayout = {
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

export interface GovernanceAdapter {
  readonly adapterName: string;
  readonly layout: GovernanceLayout;
  readonly stores: GovernanceStores;
}
