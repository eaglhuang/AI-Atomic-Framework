import type { TaskResidueBucket } from './residue-diagnostics.ts';
export type TaskflowCloseMode = 'normal-close' | 'historical-delivery-close' | 'planning-mirror-sync-repair' | 'residue-repair' | 'ambiguous-manual-review';
export type TaskflowCloseBackend = 'tasks-close' | 'tasks-reconcile' | 'tasks-import' | 'tasks-repair-closure' | 'tasks-status';
export declare const taskflowCloseEvidenceValidators: readonly string[];
export declare const taskflowCloseGovernanceEvidenceValidator = "node --strip-types scripts/validate-governance-commands.ts --mode validate";
export declare function resolveTaskflowCloseBackend(bucket: TaskResidueBucket, closeMode: TaskflowCloseMode): TaskflowCloseBackend;
export declare function resolveTaskflowCloseMode(input: {
    bucket: TaskResidueBucket;
    liveStatus: string | null;
    planningStatus?: string | null;
    historicalDeliveryRefs: string[];
    planningAuthorityDeliveryOk?: boolean;
    divergenceCount: number;
}): TaskflowCloseMode;
