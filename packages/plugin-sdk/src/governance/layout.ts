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
  readonly contextSummaryStorePath?: string;
}

export const defaultGovernanceLayout: GovernanceLayout = {
  root: '.atm',
  taskStorePath: '.atm/tasks',
  lockStorePath: '.atm/locks',
  documentIndexPath: '.atm/index',
  shardStorePath: '.atm/shards',
  stateStorePath: '.atm/state',
  artifactStorePath: '.atm/artifacts',
  logStorePath: '.atm/logs',
  runReportStorePath: '.atm/reports',
  ruleGuardPath: '.atm/rules',
  evidenceStorePath: '.atm/evidence',
  registryStorePath: '.atm/registry',
  contextSummaryStorePath: '.atm/state/context-summary'
};

export interface GovernanceAdapter {
  readonly adapterName: string;
  readonly layout: GovernanceLayout;
  readonly stores: GovernanceStores;
}