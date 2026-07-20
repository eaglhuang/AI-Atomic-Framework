import { type ClosurePacket } from '../../framework-development.ts';
type AbandonResidueDispositionClass = 'keep-diagnostic' | 'abandon' | 'remove-evidence';
/**
 * ATM-GOV-0181 / ATM-BUG-2026-07-12-147:
 * After abandon, remove only disposable generated residue (bundle-manifest),
 * unstage abandoned-task ownership paths so the next lane is not foreign-staged,
 * and record an explicit disposition packet that keeps the audit trail admissible.
 */
export declare function applyAbandonedResidueDisposition(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly reason: string | null;
}): {
    readonly dispositionPath: string;
    readonly disposition: AbandonResidueDispositionClass;
    readonly removed: readonly string[];
    readonly unstaged: readonly string[];
    readonly keptAuditTrail: readonly string[];
};
export declare function executeCloseWrites(input: {
    readonly options: any;
    readonly actorId: string;
    readonly taskPath: string;
    readonly previousTaskContent: string;
    readonly taskDocument: Record<string, unknown>;
    readonly activeSession: {
        readonly sessionId?: string | null;
    } | null;
    readonly previousStatus: string;
    readonly owningBatch: {
        readonly batchId?: string | null;
    } | null;
    readonly effectiveHistoricalDeliveryRefs: readonly string[];
    readonly pendingClosurePacket: ClosurePacket | null;
    readonly createdClosurePacketAbsolute: string | null;
    readonly closurePacketPath: string | null;
    readonly closurePacket: ClosurePacket | null;
}): Promise<{
    transitionPath: string;
    closurePacketPath: string | null;
}>;
export {};
