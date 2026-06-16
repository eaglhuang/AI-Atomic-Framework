import { type TaskDependencyCloseoutBlocker } from './closeout-provenance.ts';
export type TaskClaimDependencyBlocker = TaskDependencyCloseoutBlocker;
export interface TaskDependencyRouteSummary {
    readonly workItemId: string;
    readonly dependencies: readonly string[];
}
export declare function findTaskClaimDependencyBlockers(cwd: string, taskId: string, taskDocument: Record<string, unknown>): TaskClaimDependencyBlocker[];
export declare function areTaskDependenciesSatisfied(task: TaskDependencyRouteSummary, statusById: ReadonlyMap<string, string>, cwd?: string): boolean;
