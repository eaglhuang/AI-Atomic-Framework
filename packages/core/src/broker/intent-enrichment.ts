import { buildResourceOverlapReport, type ResourceOverlapReport } from './resource-overlap.ts';
import type { ActiveWriteIntent, WriteIntent } from './types.ts';

export interface EnrichedWriteIntent {
  readonly intent: WriteIntent;
  readonly resourceOverlapReport: ResourceOverlapReport;
}

export function enrichWriteIntentWithResourceOverlaps(
  intent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): EnrichedWriteIntent {
  return {
    intent: {
      ...intent,
      resourceOverlaps: buildResourceOverlapReport(intent, activeIntents).facts
    },
    resourceOverlapReport: buildResourceOverlapReport(intent, activeIntents)
  };
}
