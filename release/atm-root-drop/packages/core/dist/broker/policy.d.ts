import type { DecompositionTargetFunction, LineRange } from './types.ts';
import type { Layer2Conflict } from './agr.ts';
export interface AgrThresholds {
    readonly maxConflictCount: number;
    readonly maxConflictDensity: number;
}
export declare const DEFAULT_AGR_LAYER2_THRESHOLDS: AgrThresholds;
export interface Layer2Trigger {
    readonly trigger: false;
    readonly reason: string;
}
export interface Layer2TriggerDecision {
    readonly trigger: true;
    readonly targetFunction: DecompositionTargetFunction;
    readonly conflictRegion: LineRange;
}
export declare function shouldTriggerLayer2(conflicts: readonly Layer2Conflict[], thresholds: AgrThresholds): Layer2Trigger | Layer2TriggerDecision;
