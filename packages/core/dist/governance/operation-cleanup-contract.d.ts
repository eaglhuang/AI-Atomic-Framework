export type OperationCleanupOutcome = 'succeeded' | 'failed' | 'timed-out' | 'cancelled';
export type OperationCleanupDisposition = 'restored' | 'recovery-retained';
export interface OperationCleanupPath {
    readonly path: string;
    readonly beforeDigest: string | null;
    readonly afterDigest: string | null;
}
/**
 * A durable handoff for bytes created by one governed operation.  The contract
 * deliberately names facts, not product-specific recovery actions: callers
 * decide how to restore only after this receipt proves ownership and the exact
 * pre/post state.
 */
export interface OperationCleanupReceipt {
    readonly schemaId: 'atm.operationCleanupReceipt.v1';
    readonly operationId: string;
    readonly owner: {
        readonly taskId: string;
        readonly actorId: string;
        readonly laneSessionId: string | null;
    };
    readonly outcome: OperationCleanupOutcome;
    readonly disposition: OperationCleanupDisposition;
    readonly paths: readonly OperationCleanupPath[];
    readonly retryToken: string | null;
    readonly terminal: boolean;
    readonly digest: string;
}
export interface CreateOperationCleanupReceiptInput {
    readonly operationId?: string;
    readonly owner: OperationCleanupReceipt['owner'];
    readonly outcome: OperationCleanupOutcome;
    readonly disposition: OperationCleanupDisposition;
    readonly paths: readonly OperationCleanupPath[];
}
export declare function createOperationCleanupReceipt(input: CreateOperationCleanupReceiptInput): OperationCleanupReceipt;
export declare function validateOperationCleanupReceipt(value: unknown): {
    readonly ok: boolean;
    readonly reason: string | null;
};
