import { preflightBlockersToWriteReadinessBlockers, type HistoricalClosePreflightSummary } from './historical-close-preflight.ts';
export type { HistoricalClosePreflightSummary };
export interface TaskflowPlanningAuthorityDeliveryGate {
    required: boolean;
    ok: boolean;
    repoRoot: string | null;
    matchedFiles: string[];
    reason: string | null;
}
export declare function extractTaskflowDeclaredFiles(taskDocument: Record<string, unknown>): string[];
export declare function inspectPlanningAuthorityDelivery(input: {
    cwd: string;
    taskDocument: Record<string, unknown>;
    historicalDeliveryRefs: string[];
    resolvedPlanningMirrorPath?: string | null;
}): TaskflowPlanningAuthorityDeliveryGate;
export declare function buildTaskflowClosePreflight(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    taskDocument: Record<string, unknown>;
    previewCommitBundle: unknown;
    historicalDeliveryRefs: string[];
    waiverOutOfScopeDelivery: boolean;
    waiverReason: string | null;
}): HistoricalClosePreflightSummary;
export declare function buildPlanningDeliveryRequiredCommand(taskId: string, actorId: string): string;
export { preflightBlockersToWriteReadinessBlockers };
