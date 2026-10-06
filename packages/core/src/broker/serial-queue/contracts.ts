import type { WriteIntent } from '../types.ts';

export type SerialQueueState = 'queued' | 'eligible' | 'granted' | 'released' | 'cancelled' | 'expired';

export interface SerialQueueTicket {
  readonly ticketId: string;
  readonly sequence: number;
  readonly taskId: string;
  readonly actorId: string;
  readonly scopeDigest: string;
  readonly intent: WriteIntent;
  readonly state: SerialQueueState;
  readonly enqueuedAt: number;
  readonly eligibleAt: number | null;
  readonly grantedAt: number | null;
  readonly expiresAt: number;
  readonly blockerIntentIds: readonly string[];
}

export interface SerialQueueEvent {
  readonly sequence: number;
  readonly ticketId: string;
  readonly taskId: string;
  readonly state: SerialQueueState;
  readonly at: number;
  readonly waitMs: number;
  readonly blockerIntentIds: readonly string[];
}

export interface SerialQueueDocument {
  readonly schemaId: 'atm.brokerSerialQueue.v1';
  readonly nextSequence: number;
  readonly nextEventSequence: number;
  readonly tickets: readonly SerialQueueTicket[];
  readonly events: readonly SerialQueueEvent[];
}

export interface SerialQueueObservation {
  readonly ticketId: string;
  readonly state: SerialQueueState;
  readonly sequence: number;
  readonly position: number;
  readonly waitMs: number;
  readonly blockerIntentIds: readonly string[];
  readonly expiresAt: number;
  readonly authorityDigest: string;
  readonly writeAuthorized: false;
}
