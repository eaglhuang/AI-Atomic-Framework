import { type AtmFileScopeReport } from '../../../../core/src/broker/atm-core-scope.ts';
import { type TaskDependencyCloseoutBlocker } from './closeout-provenance.ts';
export type TaskClaimDependencyBlocker = TaskDependencyCloseoutBlocker & {
    readonly blockedByDependency?: true;
    readonly dependencyTaskIds?: readonly string[];
    readonly scopeClass?: AtmFileScopeReport;
    readonly codeFilesBlocked?: readonly string[];
    readonly allowedDependencyBlockedRoute?: 'docs-ledger-planning';
};
export interface TaskDependencyRouteSummary {
    readonly workItemId: string;
    readonly dependencies: readonly string[];
}
export interface TaskClaimDependencyGateOptions {
    readonly claimFiles?: readonly string[];
}
export declare function findTaskClaimDependencyBlockers(cwd: string, taskId: string, taskDocument: Record<string, unknown>, options?: TaskClaimDependencyGateOptions): TaskClaimDependencyBlocker[];
export declare function areTaskDependenciesSatisfied(task: TaskDependencyRouteSummary, statusById: ReadonlyMap<string, string>, cwd?: string): boolean;
