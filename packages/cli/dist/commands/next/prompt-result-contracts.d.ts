export declare function createNextProfiler(header?: string): {
    mark(label: string): void;
    flush(label: string): void;
};
export declare function buildPlanningCardImportRequirement(task: ImportedTaskSummary | null | undefined): {
    schemaId: string;
    status: string;
    taskId: any;
    sourcePlanPath: any;
    taskCardPath: any;
    requiredCommand: string;
    dryRunCommand: string;
    reason: string;
} | null;
export declare function isReadOnlyPromptScopeMiss(taskIntent: TaskIntent | null): boolean;
export declare function buildPromptScopeQueueResult(input: {
    readonly cwd: string;
    readonly actor?: string;
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly selectedTasks: ImportedTaskSummary[];
    readonly queueHeadTask: ImportedTaskSummary | null;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult;
