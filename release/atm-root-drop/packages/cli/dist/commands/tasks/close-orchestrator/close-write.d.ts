import { type ClosurePacket } from '../../framework-development.ts';
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
