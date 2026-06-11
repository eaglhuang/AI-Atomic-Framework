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

export function normalizeLineRange(range: ParsedLineRange): LineRange {
  const start = Math.max(1, Math.min(range.lineStart, range.lineEnd));
  const end = Math.max(start, Math.max(range.lineStart, range.lineEnd));
  return {
    filePath: range.filePath.replace(/\\/g, '/'),
    lineStart: start,
    lineEnd: end
  };
}

export function rangesOverlap(left: LineRange, right: LineRange): boolean {
  return Math.max(left.lineStart, right.lineStart) <= Math.min(left.lineEnd, right.lineEnd);
}

export function intersectRanges(left: LineRange, right: LineRange): LineRange {
  return normalizeLineRange({
    filePath: left.filePath,
    lineStart: Math.max(left.lineStart, right.lineStart),
    lineEnd: Math.min(left.lineEnd, right.lineEnd)
  });
}

export function rangeLength(range: LineRange): number {
  return Math.max(0, range.lineEnd - range.lineStart + 1);
}
