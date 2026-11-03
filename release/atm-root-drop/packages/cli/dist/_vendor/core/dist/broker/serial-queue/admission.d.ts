import type { WriteBrokerRegistryDocument, WriteIntent } from '../types.js';
import type { SerialQueueObservation } from './contracts.js';
export interface SerialQueueResume {
    readonly ticketId?: string;
    readonly currentBaseCommit?: string | null;
}
/** One owner/scope/expiry/base snapshot consumed by preview and the CAS writer. */
export declare function resolveSerialAdmission(intent: WriteIntent, registry: WriteBrokerRegistryDocument, resume?: SerialQueueResume, now?: number): {
    readonly registry: WriteBrokerRegistryDocument;
    readonly queue?: SerialQueueObservation;
    readonly disposition?: 'queue' | 'revalidate';
    readonly reason?: string;
    readonly revalidatedTicketId?: string;
    readonly privateWork?: boolean;
};
