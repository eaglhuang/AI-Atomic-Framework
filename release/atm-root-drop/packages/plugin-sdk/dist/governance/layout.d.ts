import type { GovernanceStores } from './stores';
export interface GovernanceLayout {
    readonly root: string;
    readonly taskStorePath: string;
    readonly taskEventStorePath?: string;
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
export declare const defaultGovernanceLayout: GovernanceLayout;
export interface GovernanceAdapter {
    readonly adapterName: string;
    readonly layout: GovernanceLayout;
    readonly stores: GovernanceStores;
}
