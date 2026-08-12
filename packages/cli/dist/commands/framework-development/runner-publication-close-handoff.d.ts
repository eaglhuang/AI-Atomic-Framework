export interface RunnerPublicationCloseHandoff {
    readonly ok: boolean;
    readonly stageFiles: readonly string[];
    readonly reason: string | null;
}
/** Converts a sealed receipt into an exact, task-owned close bundle. */
export declare function resolveRunnerPublicationCloseHandoff(input: {
    readonly taskId: string;
    readonly receipt: Record<string, unknown> | null;
}): RunnerPublicationCloseHandoff;
/**
 * Authorizes a close commit only when its framework-critical outputs are the
 * exact task-owned inventory sealed by the runner-publication receipt.
 */
export declare function authorizesRunnerPublicationCloseCommit(input: {
    readonly taskId: string;
    readonly receipt: Record<string, unknown> | null;
    readonly criticalChangedFiles: readonly string[];
}): boolean;
