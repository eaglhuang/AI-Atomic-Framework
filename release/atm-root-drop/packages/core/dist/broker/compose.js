import { anchorKey, buildMergePlan, parsePatchHunkRanges, patchHunkRangesOverlap, sortProposalsForCompose } from './merge-plan.js';
export function composeBrokerProposals(proposals) {
    if (proposals.length === 0) {
        throw new Error('compose requires at least one proposal');
    }
    const sorted = sortProposalsForCompose(proposals);
    const conflicts = [];
    const cidConflicts = detectCidConflicts(sorted);
    if (cidConflicts.length > 0) {
        return {
            ok: false,
            mergePlan: buildMergePlan({
                proposals: sorted,
                verdict: 'blocked-cid-conflict',
                conflicts: cidConflicts
            })
        };
    }
    const metadataConflicts = detectMetadataMismatches(sorted);
    conflicts.push(...metadataConflicts);
    const anchorConflicts = detectAnchorOverlaps(sorted);
    conflicts.push(...anchorConflicts);
    const rangeConflicts = detectPatchRangeOverlaps(sorted);
    conflicts.push(...rangeConflicts);
    if (conflicts.length > 0) {
        return {
            ok: true,
            mergePlan: buildMergePlan({
                proposals: sorted,
                verdict: 'needs-steward',
                conflicts
            })
        };
    }
    return {
        ok: true,
        mergePlan: buildMergePlan({
            proposals: sorted,
            verdict: 'parallel-safe',
            conflicts: []
        })
    };
}
function detectCidConflicts(proposals) {
    const conflicts = [];
    const atomIdOwners = new Map();
    const atomCidOwners = new Map();
    for (const proposal of proposals) {
        for (const ref of proposal.atomRefs) {
            const existingAtomIdOwner = atomIdOwners.get(ref.atomId);
            if (existingAtomIdOwner && existingAtomIdOwner !== proposal.proposalId) {
                conflicts.push({
                    kind: 'cid',
                    detail: `CID conflict: atomId '${ref.atomId}' appears in proposals '${existingAtomIdOwner}' and '${proposal.proposalId}'`
                });
            }
            else {
                atomIdOwners.set(ref.atomId, proposal.proposalId);
            }
            const existingAtomCidOwner = atomCidOwners.get(ref.atomCid);
            if (existingAtomCidOwner && existingAtomCidOwner !== proposal.proposalId) {
                conflicts.push({
                    kind: 'cid',
                    detail: `CID conflict: atomCid '${ref.atomCid}' appears in proposals '${existingAtomCidOwner}' and '${proposal.proposalId}'`
                });
            }
            else {
                atomCidOwners.set(ref.atomCid, proposal.proposalId);
            }
        }
    }
    return dedupeConflicts(conflicts);
}
function detectMetadataMismatches(proposals) {
    const conflicts = [];
    const groups = groupByTargetFile(proposals);
    for (const [targetFile, group] of groups) {
        if (group.length < 2)
            continue;
        const baseCommit = group[0].baseCommit;
        const fileBeforeHash = group[0].fileBeforeHash;
        for (const proposal of group.slice(1)) {
            if (proposal.baseCommit !== baseCommit) {
                conflicts.push({
                    kind: 'file-range',
                    detail: `Metadata mismatch on '${targetFile}': baseCommit '${proposal.baseCommit}' does not match '${baseCommit}' from '${group[0].proposalId}'`
                });
            }
            if (proposal.fileBeforeHash !== fileBeforeHash) {
                conflicts.push({
                    kind: 'file-range',
                    detail: `Metadata mismatch on '${targetFile}': fileBeforeHash '${proposal.fileBeforeHash}' does not match '${fileBeforeHash}' from '${group[0].proposalId}'`
                });
            }
        }
    }
    return dedupeConflicts(conflicts);
}
function detectAnchorOverlaps(proposals) {
    const conflicts = [];
    const groups = groupByTargetFile(proposals);
    for (const [targetFile, group] of groups) {
        if (group.length < 2)
            continue;
        const owners = new Map();
        for (const proposal of group) {
            for (const anchor of proposal.anchors) {
                const key = anchorKey(anchor);
                const existingOwner = owners.get(key);
                if (existingOwner && existingOwner !== proposal.proposalId) {
                    conflicts.push({
                        kind: 'file-range',
                        detail: `Anchor overlap on '${targetFile}': '${key}' appears in proposals '${existingOwner}' and '${proposal.proposalId}'`
                    });
                }
                else {
                    owners.set(key, proposal.proposalId);
                }
            }
        }
    }
    return dedupeConflicts(conflicts);
}
function detectPatchRangeOverlaps(proposals) {
    const conflicts = [];
    const groups = groupByTargetFile(proposals);
    for (const [targetFile, group] of groups) {
        if (group.length < 2)
            continue;
        const ranged = group.map((proposal) => ({
            proposalId: proposal.proposalId,
            ranges: parsePatchHunkRanges(proposal.patch)
        }));
        for (let leftIndex = 0; leftIndex < ranged.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < ranged.length; rightIndex += 1) {
                const left = ranged[leftIndex];
                const right = ranged[rightIndex];
                for (const leftRange of left.ranges) {
                    for (const rightRange of right.ranges) {
                        if (patchHunkRangesOverlap(leftRange, rightRange)) {
                            conflicts.push({
                                kind: 'file-range',
                                detail: `Patch hunk overlap on '${targetFile}' between proposals '${left.proposalId}' and '${right.proposalId}'`
                            });
                        }
                    }
                }
            }
        }
    }
    return dedupeConflicts(conflicts);
}
function groupByTargetFile(proposals) {
    const groups = new Map();
    for (const proposal of proposals) {
        const existing = groups.get(proposal.targetFile) ?? [];
        existing.push(proposal);
        groups.set(proposal.targetFile, existing);
    }
    return groups;
}
function dedupeConflicts(conflicts) {
    const seen = new Set();
    const unique = [];
    for (const conflict of conflicts) {
        const key = `${conflict.kind}::${conflict.detail}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(conflict);
    }
    return unique.sort((left, right) => `${left.kind}::${left.detail}`.localeCompare(`${right.kind}::${right.detail}`));
}
