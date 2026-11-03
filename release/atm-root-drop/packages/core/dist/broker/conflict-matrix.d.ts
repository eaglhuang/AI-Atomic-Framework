import type { ActiveWriteIntent, BrokerConflictMatrix, WriteIntent } from './types.js';
export type { BrokerArbitrationVerdict, BrokerConflictClassResult, BrokerConflictGateResult, BrokerConflictMatrix } from './types.js';
export { compareResourceKeys, type ResourceKeyOverlapFact, type ResourceKeyOverlapVerdict } from './resource-overlap.js';
export declare function evaluateConflictMatrix(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[], options?: {
    readonly currentEpoch?: number;
}): BrokerConflictMatrix;
