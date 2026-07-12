import type { ActiveWriteIntent, BrokerConflictMatrix, WriteIntent } from './types.ts';
export type { BrokerArbitrationVerdict, BrokerConflictClassResult, BrokerConflictGateResult, BrokerConflictMatrix } from './types.ts';
export declare function evaluateConflictMatrix(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[], options?: {
    readonly currentEpoch?: number;
}): BrokerConflictMatrix;
