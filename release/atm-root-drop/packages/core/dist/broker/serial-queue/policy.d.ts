import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../types.js';
import type { SerialQueueDocument, SerialQueueTicket } from './contracts.js';
export declare const SERIAL_QUEUE_POLICY: Readonly<{
    eligibleLeaseMs: 30000;
    historyLimit: 256;
    eventLimit: 512;
}>;
export declare function serialScopeDigest(intent: WriteIntent): string;
export declare function digest(value: unknown): string;
export declare function isPendingSerialTicket(ticket: SerialQueueTicket, now?: number): boolean;
export declare function pendingSerialTickets(doc: WriteBrokerRegistryDocument, now?: number): readonly SerialQueueTicket[];
export declare function activeAsIntent(active: ActiveWriteIntent): WriteIntent;
export declare function hasSerialReadDependency(left: WriteIntent, right: WriteIntent): boolean;
/** Logical overlap, not a global file lock. Missing bounds remain conservative. */
export declare function serialScopesConflict(left: WriteIntent, right: WriteIntent): boolean;
export declare function serialPredecessors(intent: WriteIntent, doc: WriteBrokerRegistryDocument, now?: number): readonly SerialQueueTicket[];
/** Only the incumbent's monotonic readiness upgrade may precede its later waiters. */
export declare function isProposalReadinessUpgrade(intent: WriteIntent, active: ActiveWriteIntent, now: number): boolean;
export declare function ownsExactActiveSerialScope(intent: WriteIntent, active: ActiveWriteIntent): boolean;
export declare function isSerialQueueDocument(value: unknown): value is SerialQueueDocument;
