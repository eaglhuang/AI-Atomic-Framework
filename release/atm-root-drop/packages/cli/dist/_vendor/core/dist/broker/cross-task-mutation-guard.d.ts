import { type TerminalHistoryOwnershipState } from './terminal-history-entitlement.js';
export interface CrossTaskMutationBlock {
    readonly conflictTaskId: string;
    readonly conflictFiles: readonly string[];
    readonly commandFamily: string;
    readonly recoveryLane: string;
    readonly conflicts: readonly CrossTaskMutationConflict[];
}
export interface CrossTaskMutationConflict {
    readonly conflictTaskId: string;
    readonly conflictFiles: readonly string[];
    readonly owner: string;
    readonly surface: 'task-history' | 'active-task-scope';
    /**
     * ATM-GOV-0369 amendment 1: what the authority snapshot actually reported
     * about the owner. A refusal may only describe an ownership state that was
     * read; it must never call an owner active without having evaluated it.
     */
    readonly ownershipState?: TerminalHistoryOwnershipState;
}
export interface ActiveTaskInfo {
    readonly taskId: string;
    readonly owner: string;
    readonly allowedFiles: readonly string[];
}
/**
 * Resolve the task that owns a governance history path, or null when the path is
 * not task history or names a task this repository does not know. Admission and
 * governed staging must never disagree about who owns `.atm/history/**`, so this
 * is the only place that answer is derived.
 */
export declare function resolveTaskHistoryOwnerTaskId(cwd: string, filePath: string): string | null;
export declare function getActiveTasks(cwd: string): readonly ActiveTaskInfo[];
/**
 * ATM-GOV-0369 amendment 1: the one authority question the task-history surface
 * used to skip. Answers from the same ledger facts `getActiveTasks` reads —
 * status, claim state, and lock release — so both surfaces agree about what a
 * task currently owns. An unreadable record stays `live`, which fails closed.
 */
export declare function readTaskWriteAuthority(cwd: string, taskId: string): 'live' | 'terminal';
export declare function detectCrossTaskMutation(cwd: string, currentTaskId: string | null, commandFamily: string, candidateFiles?: readonly string[]): CrossTaskMutationBlock | null;
export declare function isIncidentStillActive(cwd: string, block: CrossTaskMutationBlock, currentTaskId?: string | null): boolean;
export declare function reconcileStaleIncidents(cwd: string, currentTaskId?: string | null): boolean;
export declare function recordIncidentFlag(cwd: string, block: CrossTaskMutationBlock): void;
export declare function readIncidentFlag(cwd: string, currentTaskId?: string | null): CrossTaskMutationBlock | null;
export declare function clearIncidentFlags(cwd: string): void;
