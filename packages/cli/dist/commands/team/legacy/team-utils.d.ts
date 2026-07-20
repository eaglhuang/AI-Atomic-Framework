export declare function summarizeTask(taskId: string, task: Record<string, unknown> | null | undefined): {
    taskId: string;
    title: {};
    status: {} | null;
    targetRepo: {} | null;
    sourcePlanPath: {} | null;
};
export declare function readOptionValue(argv: string[], flag: string): string | undefined;
export declare function deriveWritePaths(task: Record<string, unknown> | null | undefined, repoRoot?: string): string[];
export declare function deriveTeamWriteScope(task: Record<string, unknown> | null | undefined, repoRoot?: string): {
    writePaths: string[];
    planningReadOnlyPaths: string[];
    allowEmptyWriteScope: boolean;
};
export declare function normalizeTargetWritePathArray(paths: string[], repoRoot?: string): string[];
export declare function collectTaskPathHints(task: Record<string, unknown> | null | undefined): string[];
export declare function normalizeTaskPathArray(value: unknown, repoRoot?: string): string[];
export declare function normalizeStringArray(value: unknown): string[];
export declare function uniqueStrings(values: string[]): string[];
