import { resolveCandidatePlanningRoots } from './planning-root-preference.ts';
import { type TaskQueueRecord } from '../task-direction.ts';
import { type RequestedTaskAction, type TaskIntent, type TaskIntentSource } from './intent-normalizers.ts';
import { type ImportedTaskQueue, type ImportedTaskSummary, type PromptScopedRouteStatus, type PromptScopedTaskRoute } from './route-predicates.ts';
export type NextClaimIntent = 'write' | 'closeout-only';
export declare function resolvePromptScopedTaskContext(cwd: string, input: {
    readonly prompt?: string | null;
    readonly intentPath?: string | null;
}): PromptScopedTaskContext;
export declare function resolveTaskIntent(cwd: string, input: {
    readonly prompt?: string;
    readonly intentPath?: string;
    readonly explicitTaskIds?: readonly string[];
}): TaskIntent | null;
export declare function findActiveTaskQueueForIntent(cwd: string, intent: TaskIntent | null, options?: {
    readonly sourcePromptFallback?: string | null;
    readonly taskId?: string | null;
}): TaskQueueRecord | null;
export declare function reconcilePromptScopeRuntimeForClaim(cwd: string, taskIntent: TaskIntent | null, selectedTasks: readonly ImportedTaskSummary[]): {
    queue: TaskQueueRecord;
    batchRun: import("../work-channels.ts").BatchRunRecord | null;
    queueHeadTask: ImportedTaskSummary | null;
} | null;
export declare function findActiveBatchRunForIntent(cwd: string, intent: TaskIntent | null, options?: {
    readonly sourcePromptFallback?: string | null;
    readonly taskId?: string | null;
}): import("../work-channels.ts").BatchRunRecord | null;
export declare function createDeterministicTaskIntent(prompt: string, explicitTaskIds?: readonly string[]): TaskIntent;
export declare function resolvePromptScopedTaskRoute(cwd: string, tasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null, planningRootResolution?: ReturnType<typeof resolveCandidatePlanningRoots>): PromptScopedTaskRoute | null;
/**
 * Handoff documents are workspace-level artifacts rather than task cards, so
 * their filename cannot score against a ledger task path. When a handoff is
 * explicitly named, use the handoff's task references only as a constrained
 * hint: a referenced active claim is safe, a stale reference is not, and an
 * unqualified handoff may fall back only when exactly one active claim exists.
 */
export declare function resolveHandoffResumeTaskRoute(cwd: string, tasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): PromptScopedTaskRoute | null;
export declare function isActiveClaimedTask(task: ImportedTaskSummary): boolean;
export declare function isHandoffPrompt(prompt: string): boolean;
export declare function findTaskByTaskIdReference(tasks: readonly ImportedTaskSummary[], taskIdReference: string): ImportedTaskSummary | null;
export declare function assertPromptBatchDoesNotConflict(input: {
    readonly cwd: string;
    readonly promptScope: PromptScopedTaskRoute | null;
    readonly allTasks: readonly ImportedTaskSummary[];
    readonly sourcePrompt: string | null;
    readonly currentBatchId?: string | null;
}): void;
export declare function scoreTaskForIntent(cwd: string, task: ImportedTaskSummary, intent: TaskIntent): ImportedTaskSummary;
export declare function applyOrdinalScope(tasks: readonly ImportedTaskSummary[], intent: TaskIntent): readonly ImportedTaskSummary[];
export declare function resolveRouteTargetRepo(tasks: readonly ImportedTaskSummary[]): string | null;
export declare function extractTaskRootHintsFromPrompt(prompt: string, mentionedTaskIds: readonly string[]): readonly string[];
export declare function extractTaskIdReferencesFromPrompt(prompt: string): readonly string[];
export declare function isBacklogIdentifier(reference: string): boolean;
export declare function expandTaskIdReferenceAliases(taskIdReference: string): readonly string[];
export declare function extractTaskFamilyRootHintsFromPrompt(prompt: string): readonly string[];
export declare function dedupeTasks(tasks: readonly ImportedTaskSummary[]): readonly ImportedTaskSummary[];
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
export declare function resolveQuickfixScope(prompt: string): string[];
interface PendingTaskArtifactScopeDiagnostic {
    readonly schemaId: 'atm.taskArtifactScopeDiagnostic.v1';
    readonly ignoredUntrackedFiles: readonly string[];
    readonly advisoryTrackedFiles: readonly string[];
}
/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
export declare function checkPendingTaskArtifactScopeExpansion(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
}): PendingTaskArtifactScopeDiagnostic;
export declare function buildNonPlaybookRouteHints(cwd: string, prompt: string): {
    playbookState: "absent";
    structuredOutputHint: {
        schemaId: "atm.nextStructuredOutputHint.v1";
        hasPlaybook: boolean;
        treatCliJsonAs: "structured-tool-guidance";
        followNextActionField: "evidence.nextAction.command";
    };
    ignoredArtifactForceAddHints: {
        path: string;
        requiredCommand: string;
        reason: string;
    }[];
    promptWorktreeHint: {
        schemaId: "atm.promptWorktreeHint.v1";
        promptPathHints: string[];
        promptMatchedFiles: string[];
        atmManagedFiles: string[];
        generatedArtifactFiles: string[];
        releaseMirrorFiles: string[];
        unrelatedTrackedFiles: string[];
        unrelatedUntrackedFiles: string[];
        ignoredArtifactCount: number;
        note: string;
    };
};
export declare function listTaskCardFiles(cwd: string): readonly string[];
export declare function listPromptScopedExternalTaskCardFiles(cwd: string, intent: TaskIntent | null, planningRoots?: readonly string[]): readonly string[];
export declare function isTaskPathUnderPreferredPlanningRoots(cwd: string, taskPath: string): boolean;
export declare function findNearbyPlanPaths(cwd: string, taskPath: string): readonly string[];
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
export declare function inspectImportedTaskQueue(cwd: string, taskIntent: TaskIntent | null, claimIntent?: NextClaimIntent): ImportedTaskQueue;
export declare function isTaskIdMentioned(workItemId: string, intent: TaskIntent | null): boolean;
export declare function isTaskIdSuffixMentioned(workItemId: string, intent: TaskIntent | null): boolean;
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
export {};
