import type { LineRange } from './types.ts';
export interface VirtualAtomCandidate {
    readonly atomId: string;
    readonly atomCid: string;
    readonly symbol: string;
    readonly sourceRange: LineRange;
}
export interface Layer2Conflict {
    readonly leftAtom: VirtualAtomCandidate;
    readonly rightAtom: VirtualAtomCandidate;
    readonly conflictRegion: LineRange;
}
export interface Layer2TriggerResult {
    readonly trigger: false;
    readonly reason?: string;
}
export type Layer2TriggeredResult = {
    readonly trigger: true;
    readonly targetFunction: VirtualAtomCandidate;
    readonly conflictRegion: LineRange;
};
export interface ParsedLineRange {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
}
export declare function normalizeLineRange(range: ParsedLineRange): LineRange;
export declare function rangesOverlap(left: LineRange, right: LineRange): boolean;
export declare function intersectRanges(left: LineRange, right: LineRange): LineRange;
export declare function rangeLength(range: LineRange): number;
