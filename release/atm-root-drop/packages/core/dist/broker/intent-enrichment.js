import { buildResourceOverlapReport } from './resource-overlap.js';
export function enrichWriteIntentWithResourceOverlaps(intent, activeIntents) {
    return {
        intent: {
            ...intent,
            resourceOverlaps: buildResourceOverlapReport(intent, activeIntents).facts
        },
        resourceOverlapReport: buildResourceOverlapReport(intent, activeIntents)
    };
}
