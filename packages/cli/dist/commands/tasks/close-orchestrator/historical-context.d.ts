import { type HistoricalBatchCloseSlice } from '../close-helpers/close-window-diagnostics.ts';
export interface CloseHistoricalContext {
    readonly historicalBatchSlice: HistoricalBatchCloseSlice | null;
    readonly effectiveHistoricalDeliveryRefs: readonly string[];
    readonly allowHistoricalCloseback: boolean;
    readonly governedHistoricalBatchCheckpoint: boolean;
    readonly protectedCloseFlags: readonly string[];
    readonly requiresProtectedCloseApproval: boolean;
    readonly shouldDeferProtectedCloseApproval: boolean;
}
export declare function resolveCloseHistoricalContext(options: {
    readonly cwd: string;
    readonly taskId: string;
    readonly historicalBatchRef?: string | null;
    readonly historicalDeliveryRefs: readonly string[];
    readonly fromBatchCheckpoint?: boolean;
    readonly historicalDeliveryRepo?: string | null;
    readonly waiverOutOfScopeDelivery?: boolean;
    readonly allowStaleRunner?: boolean;
}): CloseHistoricalContext;
