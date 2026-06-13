export type CloseoutProvenanceGapSegment = 'closure-packet' | 'close-transition-metadata' | 'imported-as-done-without-governed-closeout';
export interface CloseoutProvenanceGapReport {
    readonly trusted: boolean;
    readonly bucket: 'source-done-governance-incomplete' | null;
    readonly missingSegments: readonly CloseoutProvenanceGapSegment[];
    readonly truth: string;
    readonly residue: string;
    readonly reason: string;
    readonly recoveryCommand: string;
}
export type TaskDependencyBlockerStatus = string | 'source-done-governance-incomplete' | 'incomplete-closeout';
export interface TaskDependencyCloseoutBlocker {
    readonly taskId: string;
    readonly status: TaskDependencyBlockerStatus;
    readonly taskPath: string;
    readonly missingSegments?: readonly CloseoutProvenanceGapSegment[];
    readonly requiredCommand?: string;
    readonly detail?: string;
}
export declare function verifyCloseoutProvenance(cwd: string, taskId: string, document: Record<string, unknown>): boolean;
export declare function assessCloseoutProvenanceGap(cwd: string, taskId: string, document: Record<string, unknown>): CloseoutProvenanceGapReport;
export declare function buildDependencyCloseoutBlocker(cwd: string, dependencyTaskId: string, dependencyPath: string, dependencyDocument: Record<string, unknown>): TaskDependencyCloseoutBlocker;
export declare function buildDependencyCloseoutRecoveryCommand(blocker: TaskDependencyCloseoutBlocker): string;
export declare function formatDependencyCloseoutBlockedMessage(blocker: TaskDependencyCloseoutBlocker): string;
