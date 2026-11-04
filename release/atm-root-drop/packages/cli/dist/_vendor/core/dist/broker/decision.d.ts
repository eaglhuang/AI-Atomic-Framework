import type { BrokerDecision, WriteBrokerRegistryDocument, WriteIntent } from './types.js';
export declare function calculateBrokerDecision(newIntent: WriteIntent, registry: WriteBrokerRegistryDocument, revalidatedSerialTicketId?: string): BrokerDecision;
