import { type TaskIntentSource, type RequestedTaskAction } from './next/intent-normalizers.ts';
import { type ImportedTaskSummary, type PromptScopedRouteStatus } from './next/route-predicates.ts';
export declare function runNext(argv: any): Promise<import("./shared.ts").CommandResult>;
export type NextClaimIntent = 'write' | 'closeout-only';
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
export declare function resolvePromptScopedTaskContext(cwd: string, input: {
    readonly prompt?: string | null;
    readonly intentPath?: string | null;
}): PromptScopedTaskContext;
