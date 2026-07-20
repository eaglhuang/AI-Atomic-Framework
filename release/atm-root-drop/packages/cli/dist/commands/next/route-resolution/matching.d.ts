import { resolveCandidatePlanningRoots } from '../planning-root-preference.ts';
import { type TaskIntent } from '../intent-normalizers.ts';
import { type ImportedTaskSummary, type PromptScopedTaskRoute } from '../route-predicates.ts';
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
export declare function isTaskIdMentioned(workItemId: string, intent: TaskIntent | null): boolean;
export declare function isTaskIdSuffixMentioned(workItemId: string, intent: TaskIntent | null): boolean;
