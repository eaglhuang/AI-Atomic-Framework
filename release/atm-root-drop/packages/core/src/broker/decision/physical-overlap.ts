import type { ActiveWriteIntent, ConflictDetail, DecompositionRequest, WriteIntent } from '../types.ts';
import { DEFAULT_AGR_LAYER2_THRESHOLDS, shouldTriggerLayer2 } from '../policy.ts';
import { intersectRanges, rangesOverlap, type Layer2Conflict } from '../agr.ts';
import {
  buildDecompositionRequest,
  buildLayer2ConflictDetail,
  toVirtualAtomRangesFromActiveIntent,
  toVirtualAtoms
} from './decomposition.ts';

export interface PhysicalOverlapResult {
  readonly conflicts: ConflictDetail[];
  readonly reason: string;
  readonly decompositionRequest?: DecompositionRequest;
}

export function evaluatePhysicalOverlap(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): PhysicalOverlapResult | null {
  const newIntentRanges = toVirtualAtoms(newIntent);
  const unresolvedOverlaps = new Set<string>();
  const conflicts: ConflictDetail[] = [];
  const layer2Conflicts: Layer2Conflict[] = [];

  for (const activeIntent of activeIntents) {
    if (activeIntent.taskId === newIntent.taskId) {
      continue;
    }

    const activeRanges = toVirtualAtomRangesFromActiveIntent(activeIntent);
    for (const newFile of newIntent.targetFiles) {
      if (!activeIntent.resourceKeys.files.includes(newFile)) {
        continue;
      }

      const newCandidates = newIntentRanges.filter((entry) => entry.sourceRange.filePath === newFile);
      const activeCandidates = activeRanges.filter((entry) => entry.sourceRange.filePath === newFile);

      if (newCandidates.length === 0 || activeCandidates.length === 0) {
        unresolvedOverlaps.add(newFile);
        continue;
      }

      for (const newAtom of newCandidates) {
        for (const activeAtom of activeCandidates) {
          if (!rangesOverlap(newAtom.sourceRange, activeAtom.sourceRange)) {
            conflicts.push({
              kind: 'file-range',
              detail: `Syntactic disjoint overlap on '${newFile}' for atom '${newAtom.atomCid}' and '${activeAtom.atomCid}'.`
            });
            continue;
          }

          const conflictRegion = intersectRanges(newAtom.sourceRange, activeAtom.sourceRange);
          layer2Conflicts.push({
            leftAtom: newAtom,
            rightAtom: activeAtom,
            conflictRegion
          });
        }
      }
    }
  }

  if (layer2Conflicts.length > 0) {
    const layer2Decision = shouldTriggerLayer2(layer2Conflicts, DEFAULT_AGR_LAYER2_THRESHOLDS);
    if (layer2Decision.trigger) {
      const conflictRegion = layer2Decision.conflictRegion;
      return {
        conflicts: [buildLayer2ConflictDetail(conflictRegion)],
        reason: 'Layer 2 decomposition suggestion generated from bounded overlap conflicts.',
        decompositionRequest: buildDecompositionRequest(layer2Decision.targetFunction, conflictRegion)
      };
    }

    const reason = `Layer 2 trigger skipped: ${layer2Decision.reason}`;
    return {
      conflicts: layer2Conflicts.map((conflict) => buildLayer2ConflictDetail(conflict.conflictRegion)),
      reason
    };
  }

  if (unresolvedOverlaps.size > 0) {
    return {
      conflicts: [...unresolvedOverlaps].map((filePath) => ({
        kind: 'file-range',
        detail: `Physical file overlap on '${filePath}'`
      })),
      reason: 'Physical file overlap detected but no bounded overlap evidence; routed to deterministic-composer.'
    };
  }

  return null;
}
