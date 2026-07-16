import { isJournalingPrompt, isQueueRequestedPrompt, type TaskIntent } from './intent-normalizers.ts';
type PromptScopedRouteStatus = 'ready' | 'queue' | 'ambiguous' | 'not-found' | 'empty';
interface PromptScopedTaskRoute {
    readonly status: PromptScopedRouteStatus;
    readonly selectedTasks: readonly ImportedTaskSummary[];
    readonly targetRepo: string | null;
    readonly diagnostics: readonly string[];
}
interface ImportedTaskSummary {
    readonly workItemId: string;
    readonly title: string;
    readonly status: string;
    readonly closedAt: string | null;
    readonly closedByActor: string | null;
    readonly closurePacket: string | null;
    readonly lastTransitionId: string | null;
    readonly lastTransitionAt: string | null;
    readonly milestone: string | null;
    readonly dependencies: readonly string[];
    readonly taskPath: string;
    readonly format: 'json' | 'markdown';
    readonly sourcePlanPath: string | null;
    readonly nearbyPlanPaths: readonly string[];
    readonly scopePaths: readonly string[];
    readonly targetRepo: string | null;
    readonly planningRepo: string | null;
    readonly allowPlanningMirror: boolean;
    readonly planningReadOnlyPaths: readonly string[];
    readonly planningMirrorPaths: readonly string[];
    readonly targetAllowedFiles: readonly string[];
    readonly closureAuthority: string | null;
    readonly activeClaimActorId: string | null;
    readonly activeClaimIntent: string | null;
    readonly matchScore?: number;
    readonly matchReasons?: readonly string[];
}
interface ImportedTaskQueue {
    readonly taskStorePath: string;
    readonly openTaskCount: number;
    readonly selectedTask: ImportedTaskSummary | null;
    readonly claimableTask: ImportedTaskSummary | null;
    readonly tasks: readonly ImportedTaskSummary[];
    readonly promptScope: PromptScopedTaskRoute | null;
    readonly planningRootWarnings?: readonly {
        readonly code: 'ATM_PLANNING_ROOT_AMBIGUOUS';
        readonly detail: string;
        readonly siblingRepoDirs: readonly string[];
    }[];
    readonly planningRootMissing?: {
        readonly code: 'ATM_PLANNING_ROOT_MISSING';
        readonly detail: string;
        readonly suggestedEnv: string;
        readonly suggestedConfig: Record<string, unknown>;
        readonly requiredCommand: string;
    } | null;
}
declare function isFrameworkMaintenancePrompt(prompt: string): boolean;
declare function isExplicitSingleTaskRoute(promptScope: PromptScopedTaskRoute | null, taskIntent: TaskIntent | null): boolean;
import { areTaskDependenciesSatisfied } from '../tasks/dependency-gate.ts';
declare function canTaskBePreparedForClaim(status: string): boolean;
declare function isTaskAlreadyActivelyClaimed(task: ImportedTaskSummary): boolean;
declare function isClosedTaskStatus(status: string): boolean;
declare function hasRequiredPromptScopeMatch(task: ImportedTaskSummary, intent: TaskIntent): boolean;
declare function isTaskCardSurfaceOnlyMatch(task: ImportedTaskSummary): boolean;
declare function isTaskRoutable(status: string, intent: TaskIntent | null): boolean;
declare function isTaskExplicitlyMentioned(task: ImportedTaskSummary, intent: TaskIntent | null): boolean;
declare function shouldDiscoverMarkdownTaskCards(intent: TaskIntent | null): boolean;
export { areTaskDependenciesSatisfied, canTaskBePreparedForClaim, hasRequiredPromptScopeMatch, isClosedTaskStatus, isExplicitSingleTaskRoute, isFrameworkMaintenancePrompt, isJournalingPrompt, isQueueRequestedPrompt, isTaskAlreadyActivelyClaimed, isTaskCardSurfaceOnlyMatch, isTaskExplicitlyMentioned, isTaskRoutable, shouldDiscoverMarkdownTaskCards, type ImportedTaskQueue, type ImportedTaskSummary, type PromptScopedRouteStatus, type PromptScopedTaskRoute };
