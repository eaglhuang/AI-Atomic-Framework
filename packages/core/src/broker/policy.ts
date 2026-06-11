import type { DecompositionTargetFunction, LineRange } from './types.ts';
import type { Layer2Conflict } from './agr.ts';

export interface AgrThresholds {
  readonly maxConflictCount: number;
  readonly maxConflictDensity: number;
}

export const DEFAULT_AGR_LAYER2_THRESHOLDS: AgrThresholds = {
  maxConflictCount: 4,
  maxConflictDensity: 0.5
};

export interface Layer2Trigger {
  readonly trigger: false;
  readonly reason: string;
}

export interface Layer2TriggerDecision {
  readonly trigger: true;
  readonly targetFunction: DecompositionTargetFunction;
  readonly conflictRegion: LineRange;
}

export function shouldTriggerLayer2(
  conflicts: readonly Layer2Conflict[],
  thresholds: AgrThresholds
): Layer2Trigger | Layer2TriggerDecision {
  const conflictCount = conflicts.length;
  if (conflictCount === 0) {
    return { trigger: false, reason: 'No file overlap conflicts to evaluate.' };
  }

  if (conflictCount > thresholds.maxConflictCount) {
    return { trigger: false, reason: 'Conflict count exceeds Layer 2 threshold.' };
  }

  const singleFile = new Set(conflicts.map((conflict) => conflict.conflictRegion.filePath));
  if (singleFile.size !== 1) {
    return { trigger: false, reason: 'Conflicts are not contained in one file body.' };
  }

  const conflictRegion = combineConflictRegions(conflicts);
  const conflictDensity = conflictDensityFor(conflictRegion, conflicts);
  if (conflictDensity > thresholds.maxConflictDensity) {
    return { trigger: false, reason: 'Conflict density exceeds Layer 2 threshold.' };
  }

  const targetFunction = pickTargetFunction(conflicts, conflictRegion);
  if (!targetFunction) {
    return { trigger: false, reason: 'No single bounded target function can contain all conflict lines.' };
  }

  return {
    trigger: true,
    targetFunction,
    conflictRegion
  };
}

function combineConflictRegions(conflicts: readonly Layer2Conflict[]): LineRange {
  const first = conflicts[0];
  let start = first.conflictRegion.lineStart;
  let end = first.conflictRegion.lineEnd;
  const filePath = first.conflictRegion.filePath;

  for (let index = 1; index < conflicts.length; index += 1) {
    const conflict = conflicts[index];
    if (!conflict) {
      continue;
    }
    start = Math.min(start, conflict.conflictRegion.lineStart);
    end = Math.max(end, conflict.conflictRegion.lineEnd);
  }

  return {
    filePath,
    lineStart: start,
    lineEnd: end
  };
}

function conflictDensityFor(conflictRegion: LineRange, conflicts: readonly Layer2Conflict[]): number {
  const regionLength = Math.max(1, conflictRegion.lineEnd - conflictRegion.lineStart + 1);
  const conflictArea = conflicts.reduce((sum, conflict) => {
    const overlap = Math.max(
      0,
      Math.min(conflictRegion.lineEnd, conflict.conflictRegion.lineEnd) - Math.max(conflictRegion.lineStart, conflict.conflictRegion.lineStart) + 1
    );
    return sum + overlap;
  }, 0);

  return conflictArea / regionLength;
}

function pickTargetFunction(conflicts: readonly Layer2Conflict[], conflictRegion: LineRange): DecompositionTargetFunction | null {
  const leftCandidates = uniqueCandidates(conflicts.map((conflict) => conflict.leftAtom));
  const rightCandidates = uniqueCandidates(conflicts.map((conflict) => conflict.rightAtom));

  const candidates = [...leftCandidates, ...rightCandidates];
  const fitting = candidates.filter((candidate) => rangeContains(candidate.sourceRange, conflictRegion));
  if (fitting.length === 0) {
    return null;
  }

  fitting.sort((left, right) => {
    const leftSpan = left.sourceRange.lineEnd - left.sourceRange.lineStart;
    const rightSpan = right.sourceRange.lineEnd - right.sourceRange.lineStart;
    return leftSpan - rightSpan;
  });

  const best = fitting[0];
  return {
    atomId: best.atomId,
    atomCid: best.atomCid,
    symbol: best.symbol,
    sourceRange: best.sourceRange
  };
}

function rangeContains(container: LineRange, inner: LineRange): boolean {
  return container.lineStart <= inner.lineStart && container.lineEnd >= inner.lineEnd;
}

function uniqueCandidates(candidates: Layer2Conflict['leftAtom'][]): Layer2Conflict['leftAtom'][] {
  const map = new Map<string, Layer2Conflict['leftAtom']>();
  for (const candidate of candidates) {
    map.set(`${candidate.atomId}:${candidate.sourceRange.filePath}:${candidate.sourceRange.lineStart}:${candidate.sourceRange.lineEnd}`, candidate);
  }
  return Array.from(map.values());
}
