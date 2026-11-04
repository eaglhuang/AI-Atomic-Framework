import type { WriteBrokerRegistryDocument, WriteIntent } from '../types.js';
import type { SerialQueueDocument, SerialQueueObservation, SerialQueueReason, SerialQueueState, SerialQueueTicket } from './contracts.js';
export declare function emptySerialQueue(): SerialQueueDocument;
export declare function observeSerialTicket(doc: WriteBrokerRegistryDocument, ticket: SerialQueueTicket, now?: number): SerialQueueObservation;
/** Eligibility is a short revalidation window, never an active writer lease. */
export declare function refreshSerialQueue(doc: WriteBrokerRegistryDocument, now?: number): WriteBrokerRegistryDocument;
export declare function enqueueSerialIntent(doc: WriteBrokerRegistryDocument, intent: WriteIntent, ttlSeconds: number, now?: number, reason?: SerialQueueReason): WriteBrokerRegistryDocument;
export declare function transitionSerialTicket(doc: WriteBrokerRegistryDocument, ticketId: string, state: Extract<SerialQueueState, 'granted' | 'released' | 'cancelled'>, now?: number): WriteBrokerRegistryDocument;
export declare function releaseSerialTask(doc: WriteBrokerRegistryDocument, taskId: string, now?: number): WriteBrokerRegistryDocument;
