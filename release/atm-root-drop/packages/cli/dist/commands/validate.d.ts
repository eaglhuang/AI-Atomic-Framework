export interface TaskRunnerArbitration {
    readonly schemaId: 'atm.taskRunnerArbitration.v1';
    readonly taskId: string;
    readonly dirtyInScopeFiles: readonly string[];
    readonly sourceFirstFiles: readonly string[];
    readonly foreignActiveFiles: readonly string[];
    readonly frozenFiles: readonly string[];
    readonly preferredRunnerKind: 'dev-source' | 'frozen-runner';
}
export declare function runValidate(argv: any): import("./shared.ts").CommandResult;
export declare function resolveTaskRunnerArbitration(cwd: string, taskId: string, candidateFiles?: readonly string[]): TaskRunnerArbitration;
/**
 * TASK-MAO-0042: 依據 Validator Scope Taxonomy 分類 gate 的範疇
 */
export declare function getValidatorScope(gateName: string, touchedFiles?: readonly string[]): 'task-local' | 'global-advisory' | 'release-blocking' | 'diagnostic';
