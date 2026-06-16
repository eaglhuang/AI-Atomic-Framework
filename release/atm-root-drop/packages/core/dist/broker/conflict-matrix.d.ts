import type { ActiveWriteIntent, BrokerDecision, WriteIntent } from './types.ts';
export type BrokerArbitrationVerdict = 'allow' | 'watch' | 'freeze' | 'takeover';
export interface BrokerConflictClassResult {
    readonly kind: 'shared-surface' | 'cid' | 'read-set' | 'file-range' | 'intent-shape' | 'lease';
    readonly detail: string;
    readonly blockingTask: string;
}
export interface BrokerConflictMatrix {
    readonly schemaId: 'atm.brokerConflictMatrix.v1';
    readonly specVersion: '0.1.0';
    readonly migration: BrokerDecision['migration'];
    readonly taskId: string;
    readonly arbitrationVerdict: BrokerArbitrationVerdict;
    readonly conflicts: readonly BrokerConflictClassResult[];
}
export declare function evaluateConflictMatrix(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): BrokerConflictMatrix;
