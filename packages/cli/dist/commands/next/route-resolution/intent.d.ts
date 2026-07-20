import { type RequestedTaskAction, type TaskIntent, type TaskIntentSource } from '../intent-normalizers.ts';
import { type ImportedTaskSummary, type PromptScopedRouteStatus } from '../route-predicates.ts';
export type NextClaimIntent = 'write' | 'closeout-only';
export declare function createNextProfiler(header?: string): {
    mark(label: string): void;
    flush(label: string): void;
};
export declare function resolvePromptScopedTaskContext(cwd: string, input: {
    readonly prompt?: string | null;
    readonly intentPath?: string | null;
}): PromptScopedTaskContext;
export declare function resolveTaskIntent(cwd: string, input: {
    readonly prompt?: string;
    readonly intentPath?: string;
    readonly explicitTaskIds?: readonly string[];
}): TaskIntent | null;
export declare function createDeterministicTaskIntent(prompt: string, explicitTaskIds?: readonly string[]): TaskIntent;
export declare function normalizeOptionalString(value: unknown): string | null;
export declare function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null;
export declare function extractPromptPathHints(prompt: string): readonly string[];
export interface PromptScopedTaskContext {
    readonly taskIntent: {
        readonly userPrompt: string | null;
        readonly explicitTaskIds: readonly string[];
        readonly taskScopeMentioned: boolean;
        readonly requestedAction: RequestedTaskAction | null;
        readonly source: TaskIntentSource;
    } | null;
    readonly promptScope: {
        readonly status: PromptScopedRouteStatus;
        readonly selectedTasks: readonly ImportedTaskSummary[];
        readonly targetRepo: string | null;
        readonly diagnostics: readonly string[];
    } | null;
}
