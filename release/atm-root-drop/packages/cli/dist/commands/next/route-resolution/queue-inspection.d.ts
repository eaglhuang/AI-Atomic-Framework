import { type TaskIntent } from '../intent-normalizers.ts';
import { type ImportedTaskQueue, type ImportedTaskSummary } from '../route-predicates.ts';
import { type NextClaimIntent } from './intent.ts';
import { type ImportedTaskSummaryWithOutOfScope } from './artifact-scope.ts';
export declare function inspectImportedTaskQueue(cwd: string, taskIntent: TaskIntent | null, claimIntent?: NextClaimIntent): ImportedTaskQueue;
export declare function extractJsonTaskMetadata(rawText: string): {
    schemaVersion: string | null;
    workItemId: string;
    title: string | null;
    status: string | null;
    sourcePlanPath: string | null;
    hasSource: boolean;
};
export declare function buildMinimalImportedJsonTaskSummary(input: {
    readonly cwd: string;
    readonly filePath: string;
    readonly workItemId: string;
    readonly title: string;
    readonly status: string;
    readonly sourcePlanPath: string | null;
}): ImportedTaskSummaryWithOutOfScope;
export declare function shouldSkipExternalTaskCardScan(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function shouldSkipMarkdownTaskDiscovery(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function selectImportedTaskForPromptScope(selectedTaskPool: readonly ImportedTaskSummary[], isActiveQueue: boolean, explicitSingleTaskRoute: boolean, statusById: ReadonlyMap<string, string>, cwd: string): ImportedTaskSummary | null;
export declare function isSelectedTaskClaimableForIntent(task: ImportedTaskSummary, claimIntent: NextClaimIntent): boolean;
export declare function hasPromptScopedWorkItems(importedTaskQueue: ImportedTaskQueue): boolean;
