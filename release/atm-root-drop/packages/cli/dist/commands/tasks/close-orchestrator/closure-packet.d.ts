import { type ClosurePacket } from '../../framework-development.ts';
export interface PreparedClosurePacket {
    readonly existingClosurePacketPath: string | null;
    readonly closurePacketPath: string | null;
    readonly closurePacket: ClosurePacket | null;
    readonly pendingClosurePacket: ClosurePacket | null;
    readonly createdClosurePacketAbsolute: string | null;
}
export declare function prepareClosurePacket(input: {
    readonly options: any;
    readonly taskDocument: Record<string, unknown>;
    readonly actorId: string;
    readonly activeSession: {
        readonly sessionId?: string | null;
    } | null;
    readonly frameworkStatus: any;
    readonly deliverableGate: any;
    readonly taskDeclaredFiles: readonly string[];
    readonly historicalBatchSlice: any;
}): PreparedClosurePacket;
