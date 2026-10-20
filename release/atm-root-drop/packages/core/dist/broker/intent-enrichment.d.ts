import { type ResourceOverlapReport } from './resource-overlap.js';
import type { ActiveWriteIntent, WriteIntent } from './types.js';
export interface EnrichedWriteIntent {
    readonly intent: WriteIntent;
    readonly resourceOverlapReport: ResourceOverlapReport;
}
export declare function enrichWriteIntentWithResourceOverlaps(intent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): EnrichedWriteIntent;
