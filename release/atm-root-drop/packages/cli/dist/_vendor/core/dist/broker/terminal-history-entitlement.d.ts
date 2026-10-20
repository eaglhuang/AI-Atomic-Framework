/**
 * ATM-GOV-0369 amendment 1 — who may write a terminal task's history.
 *
 * A closed task keeps generating records: bundle manifests, reconciliation
 * files, receipts. Someone has to be able to commit them. The rule that used to
 * govern this surface derived ownership from the task id embedded in the file
 * name, so the answer was "nobody, forever".
 *
 * The replacement is a governed grant rather than a resemblance. A writer is
 * entitled to a terminal task's history path when its *own* live claim was
 * admitted for that path and has an answerable live-card anchor. A normal
 * task claim anchors itself; a framework-temporary claim must declare the
 * card it is answering for. Nothing about the terminal owner's identity — its
 * id or file names — participates in the decision.
 */
export type TerminalHistoryOwnershipState = 'live' | 'terminal-entitled' | 'terminal-unentitled';
export interface ReconciliationEntitlementInput {
    /** The writer's own work item id: a task id, or a framework temporary claim. */
    readonly writerWorkItemId: string | null;
    readonly candidateFile: string;
    /** True when a live successor card backs the writer's declared linkage. */
    readonly isLiveTask: (taskId: string) => boolean;
}
/**
 * Resolve whether a writer may reconcile one path belonging to a terminal task.
 *
 * Fail-closed in every direction: an unreadable claim, a dead claim, an
 * unbounded scope, a missing linkage, or a linkage to a card that is itself
 * terminal all leave the path protected.
 */
export declare function hasReconciliationEntitlement(cwd: string, input: ReconciliationEntitlementInput, now?: number): boolean;
