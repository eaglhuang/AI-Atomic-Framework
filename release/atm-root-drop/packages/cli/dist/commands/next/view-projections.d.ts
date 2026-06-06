export interface ImportedTaskSummary {
    readonly workItemId: string;
    readonly title: string;
    readonly status: string;
    readonly closedAt: string | null;
    readonly closedByActor: string | null;
    readonly closurePacket: string | null;
    readonly lastTransitionId: string | null;
    readonly lastTransitionAt: string | null;
    readonly taskPath: string;
    readonly format: 'json' | 'markdown';
    readonly sourcePlanPath: string | null;
    readonly nearbyPlanPaths: readonly string[];
    readonly scopePaths: readonly string[];
    readonly targetRepo: string | null;
    readonly allowPlanningMirror: boolean;
    readonly planningReadOnlyPaths: readonly string[];
    readonly targetAllowedFiles: readonly string[];
    readonly matchScore?: number;
    readonly matchReasons?: readonly string[];
}
export declare function uniqueSorted(values: readonly string[]): string[];
export declare function uniqueInOrder(values: readonly string[]): string[];
export declare function sha256(value: string): string;
export declare function toTaskCandidateView(task: ImportedTaskSummary): {
    workItemId: string;
    title: string;
    status: string;
    closedAt: string | null;
    closedByActor: string | null;
    closurePacket: string | null;
    lastTransitionId: string | null;
    lastTransitionAt: string | null;
    taskPath: string;
    format: "markdown" | "json";
    sourcePlanPath: string | null;
    nearbyPlanPaths: readonly string[];
    scopePaths: readonly string[];
    planningContext: {
        readOnlyPaths: readonly string[];
    };
    targetWork: {
        allowedFiles: readonly string[];
        allowPlanningMirror: boolean;
    };
    targetRepo: string | null;
    matchScore: number;
    matchReasons: readonly string[];
};
export declare function dedupeStrings(values: readonly string[]): string[];
export declare function quoteCliValue(value: string): string;
