import type { ActiveWriteIntent, ConflictDetail, DecompositionRequest, WriteIntent } from '../types.ts';
export interface PhysicalOverlapResult {
    readonly conflicts: ConflictDetail[];
    readonly reason: string;
    readonly decompositionRequest?: DecompositionRequest;
}
export declare function evaluatePhysicalOverlap(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): PhysicalOverlapResult | null;
