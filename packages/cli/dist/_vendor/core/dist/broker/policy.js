export const DEFAULT_AGR_LAYER2_THRESHOLDS = {
    maxConflictCount: 4,
    maxConflictDensity: 0.5
};
export function shouldTriggerLayer2(conflicts, thresholds) {
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
function combineConflictRegions(conflicts) {
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
function conflictDensityFor(conflictRegion, conflicts) {
    const regionLength = Math.max(1, conflictRegion.lineEnd - conflictRegion.lineStart + 1);
    const conflictArea = conflicts.reduce((sum, conflict) => {
        const overlap = Math.max(0, Math.min(conflictRegion.lineEnd, conflict.conflictRegion.lineEnd) - Math.max(conflictRegion.lineStart, conflict.conflictRegion.lineStart) + 1);
        return sum + overlap;
    }, 0);
    return conflictArea / regionLength;
}
function pickTargetFunction(conflicts, conflictRegion) {
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
function rangeContains(container, inner) {
    return container.lineStart <= inner.lineStart && container.lineEnd >= inner.lineEnd;
}
function uniqueCandidates(candidates) {
    const map = new Map();
    for (const candidate of candidates) {
        map.set(`${candidate.atomId}:${candidate.sourceRange.filePath}:${candidate.sourceRange.lineStart}:${candidate.sourceRange.lineEnd}`, candidate);
    }
    return Array.from(map.values());
}
