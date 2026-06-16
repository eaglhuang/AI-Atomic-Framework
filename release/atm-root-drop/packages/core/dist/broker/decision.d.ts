import type { BrokerDecision, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';
export declare function calculateBrokerDecision(newIntent: WriteIntent, registry: WriteBrokerRegistryDocument): BrokerDecision;
