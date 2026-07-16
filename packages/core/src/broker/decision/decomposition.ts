import type {
  ActiveWriteIntent,
  ConflictDetail,
  DecompositionRequest,
  DecompositionTargetFunction,
  LineRange,
  SuggestedSplitAtom,
  WriteIntent
} from '../types.ts';
import { DEFAULT_AGR_LAYER2_THRESHOLDS, shouldTriggerLayer2 } from '../policy.ts';
import { intersectRanges, normalizeLineRange, rangesOverlap, type Layer2Conflict, type VirtualAtomCandidate } from '../agr.ts';

export function toVirtualAtoms(intent: WriteIntent): VirtualAtomCandidate[] {
  return intent.atomRefs
    .filter((ref) => ref.sourceRange && ref.sourceRange.filePath && ref.sourceRange.lineStart > 0 && ref.sourceRange.lineEnd > 0)
    .map((ref) => ({
      atomId: ref.atomId,
      atomCid: ref.atomCid,
      symbol: ref.atomId,
      sourceRange: normalizeLineRange({
        filePath: ref.sourceRange?.filePath ?? '',
        lineStart: ref.sourceRange?.lineStart ?? 0,
        lineEnd: ref.sourceRange?.lineEnd ?? 0
      })
    }));
}

export function toVirtualAtomRangesFromActiveIntent(intent: ActiveWriteIntent): VirtualAtomCandidate[] {
  const cidToAtomId = new Map<string, string[]>();
  for (let index = 0; index < intent.resourceKeys.atomIds.length; index += 1) {
    const atomId = intent.resourceKeys.atomIds[index];
    const atomCid = intent.resourceKeys.atomCids[index];
    if (!atomId || !atomCid) {
      continue;
    }
    const list = cidToAtomId.get(atomCid) ?? [];
    list.push(atomId);
    cidToAtomId.set(atomCid, list);
  }

  return (intent.resourceKeys.atomRanges ?? [])
    .filter((range) => range.filePath && range.lineStart > 0 && range.lineEnd > 0)
    .map((range) => {
      const sourceAtomId = cidToAtomId.get(range.atomCid)?.[0] ?? range.atomCid;
      return {
        atomId: sourceAtomId,
        atomCid: range.atomCid,
        symbol: sourceAtomId,
        sourceRange: normalizeLineRange(range)
      };
    });
}

export function buildLayer2ConflictDetail(region: LineRange): ConflictDetail {
  return {
    kind: 'file-range',
    detail: `Layer2 overlap detected on '${region.filePath}' in lines [${region.lineStart}-${region.lineEnd}]`
  };
}

export function buildDecompositionRequest(
  targetFunction: DecompositionTargetFunction,
  conflictRegion: LineRange,
  options: {
    readonly suggestionKind?: DecompositionRequest['suggestionKind'];
    readonly ownerAtomId?: string | null;
    readonly rationale?: string;
    readonly containerRange?: LineRange;
  } = {}
): DecompositionRequest {
  return {
    targetFunction,
    conflictRegion,
    constraint: 'preserve-signature',
    suggestionKind: options.suggestionKind ?? 'layer2-function-split',
    ownerAtomId: options.ownerAtomId ?? null,
    rationale: options.rationale ?? 'Broker suggests splitting the coarse write surface into smaller bounded atoms.',
    suggestedAtoms: buildSuggestedSplitAtoms(targetFunction, conflictRegion, options.containerRange)
  };
}

export function maybeBuildCidConflictDecompositionRequest(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): DecompositionRequest | null {
  const newIntentRanges = toVirtualAtoms(newIntent);
  if (newIntentRanges.length === 0) {
    return null;
  }

  const newAtomIds = new Set(newIntent.atomRefs.map((ref) => ref.atomId));
  const newAtomCids = new Set(newIntent.atomRefs.map((ref) => ref.atomCid));
  const layer2Conflicts: Layer2Conflict[] = [];

  for (const activeIntent of activeIntents) {
    if (activeIntent.taskId === newIntent.taskId) {
      continue;
    }

    const sharesCidIdentity =
      activeIntent.resourceKeys.atomIds.some((atomId) => newAtomIds.has(atomId))
      || activeIntent.resourceKeys.atomCids.some((atomCid) => newAtomCids.has(atomCid));
    if (!sharesCidIdentity) {
      continue;
    }

    const activeRanges = toVirtualAtomRangesFromActiveIntent(activeIntent);
    for (const newFile of newIntent.targetFiles) {
      if (!activeIntent.resourceKeys.files.includes(newFile)) {
        continue;
      }

      const newCandidates = newIntentRanges.filter((entry) => entry.sourceRange.filePath === newFile);
      const activeCandidates = activeRanges.filter((entry) => entry.sourceRange.filePath === newFile);
      for (const newAtom of newCandidates) {
        for (const activeAtom of activeCandidates) {
          if (!rangesOverlap(newAtom.sourceRange, activeAtom.sourceRange)) {
            continue;
          }
          const conflictRegion = intersectRanges(newAtom.sourceRange, activeAtom.sourceRange);
          const containerCandidate = [newAtom, activeAtom]
            .filter((candidate) => candidate.sourceRange.lineStart <= conflictRegion.lineStart && candidate.sourceRange.lineEnd >= conflictRegion.lineEnd)
            .sort((left, right) => {
              const leftSpan = left.sourceRange.lineEnd - left.sourceRange.lineStart;
              const rightSpan = right.sourceRange.lineEnd - right.sourceRange.lineStart;
              return rightSpan - leftSpan;
            })[0];
          const candidateTargets = [newAtom, activeAtom]
            .filter((candidate) => candidate.sourceRange.lineStart <= conflictRegion.lineStart && candidate.sourceRange.lineEnd >= conflictRegion.lineEnd)
            .sort((left, right) => {
              const leftSpan = left.sourceRange.lineEnd - left.sourceRange.lineStart;
              const rightSpan = right.sourceRange.lineEnd - right.sourceRange.lineStart;
              return leftSpan - rightSpan;
            });
          const target = candidateTargets[0];
          if (target) {
            return buildDecompositionRequest({
              atomId: target.atomId,
              atomCid: target.atomCid,
              symbol: target.symbol,
              sourceRange: target.sourceRange
            }, conflictRegion, {
              suggestionKind: 'coarse-owner-map-split',
              ownerAtomId: target.atomId,
              rationale: `Blocked same-owner overlap on '${conflictRegion.filePath}' can be reduced by splitting the coarse owner map into bounded child atoms.`,
              containerRange: containerCandidate?.sourceRange
            });
          }
          layer2Conflicts.push({
            leftAtom: newAtom,
            rightAtom: activeAtom,
            conflictRegion
          });
        }
      }
    }
  }

  if (layer2Conflicts.length === 0) {
    return null;
  }

  const layer2Decision = shouldTriggerLayer2(layer2Conflicts, DEFAULT_AGR_LAYER2_THRESHOLDS);
  if (!layer2Decision.trigger) {
    return null;
  }
  return buildDecompositionRequest(layer2Decision.targetFunction, layer2Decision.conflictRegion, {
    suggestionKind: 'coarse-owner-map-split',
    ownerAtomId: layer2Decision.targetFunction.atomId,
    rationale: `Blocked same-owner overlap on '${layer2Decision.conflictRegion.filePath}' can be reduced by splitting the coarse owner map into bounded child atoms.`,
    containerRange: layer2Decision.targetFunction.sourceRange
  });
}

export function buildSuggestedSplitAtoms(
  targetFunction: DecompositionTargetFunction,
  conflictRegion: LineRange,
  containerRangeOverride?: LineRange
): readonly SuggestedSplitAtom[] {
  const suggestions: SuggestedSplitAtom[] = [];
  const targetRange = containerRangeOverride ?? targetFunction.sourceRange;
  const baseId = targetFunction.atomId;

  suggestions.push({
    atomId: `${baseId}.focus.${conflictRegion.lineStart}-${conflictRegion.lineEnd}`,
    atomCid: toSuggestedAtomCid(baseId, 'focus', conflictRegion),
    role: 'focus',
    summary: `Focused child atom covering the conflict region ${conflictRegion.lineStart}-${conflictRegion.lineEnd}.`,
    sourceRange: conflictRegion
  });

  if (targetRange.lineStart < conflictRegion.lineStart) {
    const beforeRange = normalizeLineRange({
      filePath: targetRange.filePath,
      lineStart: targetRange.lineStart,
      lineEnd: conflictRegion.lineStart - 1
    });
    suggestions.push({
      atomId: `${baseId}.before.${beforeRange.lineStart}-${beforeRange.lineEnd}`,
      atomCid: toSuggestedAtomCid(baseId, 'before', beforeRange),
      role: 'before',
      summary: `Suggested sibling atom for the stable region before the conflict (${beforeRange.lineStart}-${beforeRange.lineEnd}).`,
      sourceRange: beforeRange
    });
  }

  if (targetRange.lineEnd > conflictRegion.lineEnd) {
    const afterRange = normalizeLineRange({
      filePath: targetRange.filePath,
      lineStart: conflictRegion.lineEnd + 1,
      lineEnd: targetRange.lineEnd
    });
    suggestions.push({
      atomId: `${baseId}.after.${afterRange.lineStart}-${afterRange.lineEnd}`,
      atomCid: toSuggestedAtomCid(baseId, 'after', afterRange),
      role: 'after',
      summary: `Suggested sibling atom for the stable region after the conflict (${afterRange.lineStart}-${afterRange.lineEnd}).`,
      sourceRange: afterRange
    });
  }

  return suggestions;
}

export function toSuggestedAtomCid(atomId: string, role: SuggestedSplitAtom['role'], range: LineRange): string {
  return `${atomId}-${role}-${range.lineStart}-${range.lineEnd}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
