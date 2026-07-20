import { DEFAULT_AGR_LAYER2_THRESHOLDS, shouldTriggerLayer2 } from '../policy.js';
import { intersectRanges, rangesOverlap } from '../agr.js';
import { findResourceOverlapMatches } from '../resource-overlap.js';
import { buildDecompositionRequest, buildLayer2ConflictDetail, toVirtualAtomRangesFromActiveIntent, toVirtualAtoms } from './decomposition.js';
export function evaluatePhysicalOverlap(newIntent, activeIntents) {
    const newIntentRanges = toVirtualAtoms(newIntent);
    const unresolvedOverlaps = new Set();
    const conflicts = [];
    const layer2Conflicts = [];
    for (const activeIntent of activeIntents) {
        if (activeIntent.taskId === newIntent.taskId) {
            continue;
        }
        const activeRanges = toVirtualAtomRangesFromActiveIntent(activeIntent);
        const seenPair = new Set();
        for (const match of findResourceOverlapMatches('file', newIntent.targetFiles, activeIntent.resourceKeys.files)) {
            const pairKey = `${match.leftKey}::${match.rightKey}`;
            if (seenPair.has(pairKey))
                continue;
            seenPair.add(pairKey);
            const newKey = match.leftKey;
            const activeKey = match.rightKey;
            // Range-level evidence lives on concrete literal filePaths in atomRefs[].sourceRange.
            // For pattern-vs-literal or pattern-vs-pattern matches we fall through to the
            // unresolved branch and report the concrete active key, which is what a compose
            // or split lane will physically contend for.
            const newCandidates = newIntentRanges.filter((entry) => entry.sourceRange.filePath === newKey);
            const activeCandidates = activeRanges.filter((entry) => entry.sourceRange.filePath === activeKey);
            if (newCandidates.length === 0 || activeCandidates.length === 0) {
                unresolvedOverlaps.add(activeKey);
                continue;
            }
            for (const newAtom of newCandidates) {
                for (const activeAtom of activeCandidates) {
                    if (!rangesOverlap(newAtom.sourceRange, activeAtom.sourceRange)) {
                        conflicts.push({
                            kind: 'file-range',
                            detail: `Syntactic disjoint overlap on '${activeKey}' for atom '${newAtom.atomCid}' and '${activeAtom.atomCid}'.`
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
