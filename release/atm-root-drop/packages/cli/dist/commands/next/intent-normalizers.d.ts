export type TaskIntentSource = 'integration-hook' | 'atm-skill' | 'cli-deterministic';
export type RequestedTaskAction = 'analyze' | 'implement' | 'redo' | 'reopen' | 'close' | 'audit' | 'cleanup';
export interface TaskIntent {
    readonly schemaId: 'atm.taskIntent.v1';
    readonly userPrompt: string | null;
    readonly explicitTaskIds: readonly string[];
    readonly mentionedTaskIds: readonly string[];
    readonly mentionedPlanPaths: readonly string[];
    readonly taskRootHints: readonly string[];
    readonly targetRepoHints: readonly string[];
    readonly requestedAction: RequestedTaskAction | null;
    readonly confidence: number;
    readonly source: TaskIntentSource;
    readonly ordinalScope: {
        readonly kind: 'first';
        readonly count: number;
    } | null;
    readonly queueRequested: boolean;
    readonly taskScopeMentioned: boolean;
}
export declare function parseMarkdownFrontmatter(text: string): Record<string, unknown>;
export declare function normalizeTaskRouteStatus(status: string): string;
export declare function normalizeOptionalBoolean(value: unknown): boolean | null;
export declare function normalizeSearchText(value: string): string;
export declare function normalizeTaskIntent(value: Record<string, unknown>, fallbackSource: TaskIntentSource): TaskIntent;
export declare function normalizeOrdinalScope(value: unknown): {
    readonly kind: 'first';
    readonly count: number;
} | null;
export declare function normalizeTaskIntentSource(value: unknown): TaskIntentSource | null;
export declare function normalizeRequestedTaskAction(value: unknown): RequestedTaskAction | null;
export declare function normalizeOptionalTaskPath(value: string | null | undefined): string | null;
export declare function readStringArray(value: unknown): readonly string[];
export declare function splitListValue(value: unknown): readonly string[];
