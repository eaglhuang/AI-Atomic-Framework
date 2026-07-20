import { type ImportedTaskQueue, type ImportedTaskSummary } from '../route-predicates.ts';
export interface ImportedTaskSummaryWithOutOfScope extends ImportedTaskSummary {
    readonly outOfScope?: readonly string[];
}
export declare function finalizeImportedTaskSummary(task: Omit<ImportedTaskSummary, 'planningReadOnlyPaths' | 'planningMirrorPaths' | 'targetAllowedFiles'> & {
    readonly outOfScope?: readonly string[];
}, cwd?: string): ImportedTaskSummaryWithOutOfScope;
export declare function withMirrorSyncOnlyTarget<T extends ImportedTaskSummary>(task: T): T;
export declare function withMirrorSyncOnlyTargetQueue(queue: ImportedTaskQueue, taskId: string): ImportedTaskQueue;
export declare function extractDeclaredTaskPathsFromDocument(taskDocument: Record<string, unknown>): string[];
export declare function extractLinkedSourceTaskArtifactPaths(cwd: string, sourcePlanPath: string | null): string[];
export declare function extractTaskArtifactPathsFromMarkdown(cwd: string, text: string): string[];
export declare function extractPathLikeStringsFromText(text: string): string[];
export declare function resolveQuickfixScope(prompt: string): string[];
