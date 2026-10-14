import { finalizeProposalAdmission } from './admission.js';
import { findOverlappingProposalRegion, resolveActiveProposalRegionsForFile, resolveProposalRegionsForFile } from './proposal-regions.js';
export { findOverlappingProposalRegion, resolveActiveProposalRegionsForFile, resolveProposalRegionsForFile } from './proposal-regions.js';
import { withFailureReason } from './failure.js';
import { findResourceOverlapMatches } from '../resource-overlap.js';
function collectSharedFiles(newIntent, activeIntent) {
    const matches = findResourceOverlapMatches('file', newIntent.targetFiles, activeIntent.resourceKeys.files);
    const shared = new Set();
    // Prefer the active (literal) key when available; that is the physical path
    // any downstream region resolver will look up in the active intent.
    for (const match of matches) {
        shared.add(match.rightKey);
    }
    return [...shared];
}
export function evaluateProposalOverlap(newIntent, activeIntents, baseAdmission, conflictMatrix) {
    if (!baseAdmission.requiresProposal) {
        return null;
    }
    let composerDecision = null;
    for (const activeIntent of activeIntents) {
        if (activeIntent.taskId === newIntent.taskId) {
            continue;
        }
        const sharedFiles = collectSharedFiles(newIntent, activeIntent);
        if (sharedFiles.length === 0) {
            continue;
        }
        const activeAdmission = activeIntent.admission;
        const activeRequiresProposal = activeAdmission?.requiresProposal ?? false;
        if (!activeRequiresProposal) {
            continue;
        }
        for (const filePath of sharedFiles) {
            const newRegions = resolveProposalRegionsForFile(newIntent, filePath);
            const activeRegions = resolveActiveProposalRegionsForFile(activeIntent, filePath);
            const overlapping = findOverlappingProposalRegion(newRegions, activeRegions);
            if (overlapping) {
                return {
                    ...withFailureReason({
                        schemaId: 'atm.brokerDecision.v1',
                        specVersion: '0.1.0',
                        migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
                        intentId: `decision-${Date.now()}`,
                        taskId: newIntent.taskId,
                        verdict: 'blocked-active-lease',
                        lane: 'blocked',
                        conflicts: [{
                                kind: 'file-range',
                                detail: `Proposal overlap detected on '${filePath}' lines [${overlapping.lineStart}-${overlapping.lineEnd}] with active task '${activeIntent.taskId}'.`
                            }],
                        applyMethod: 'none',
                        reason: `Incoming writer must wait for active writer '${activeIntent.taskId}'; proposal requirements must be satisfied before native parking or write admission.`,
                        conflictMatrix,
                        admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
                            reason: `Proposal overlap detected on the same bounded region for '${filePath}'; rearbitration is required before any write is admitted.`,
                            rearbitrationRequired: true
                        })
                    })
                };
            }
            if (newRegions.length > 0 && activeRegions.length > 0) {
                composerDecision = withFailureReason({
                    schemaId: 'atm.brokerDecision.v1',
                    specVersion: '0.1.0',
                    migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
                    intentId: `decision-${Date.now()}`,
                    taskId: newIntent.taskId,
                    verdict: 'needs-physical-split',
                    lane: 'deterministic-composer',
                    conflicts: [{
                            kind: 'file-range',
                            detail: `Proposal regions on '${filePath}' are disjoint between '${newIntent.taskId}' and '${activeIntent.taskId}'.`
                        }],
                    applyMethod: 'patch-apply',
                    reason: `Same-file proposal compare succeeded; route '${filePath}' through deterministic-composer before the second writer mutates the working tree.`,
                    conflictMatrix,
                    admission: finalizeProposalAdmission(baseAdmission, 'composer-routed', {
                        reason: `Disjoint bounded proposal regions on '${filePath}' require deterministic-composer routing before write.`,
                        rearbitrationRequired: true
                    })
                });
                continue;
            }
            composerDecision = withFailureReason({
                schemaId: 'atm.brokerDecision.v1',
                specVersion: '0.1.0',
                migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
                intentId: `decision-${Date.now()}`,
                taskId: newIntent.taskId,
                verdict: 'needs-physical-split',
                lane: 'deterministic-composer',
                conflicts: [{
                        kind: 'file-range',
                        detail: `Proposal-first same-file rearbitration required on '${filePath}' before writer admission.`
                    }],
                applyMethod: 'patch-apply',
                reason: `Incoming proposal requires composer rearbitration with active writer '${activeIntent.taskId}' on '${filePath}'; the incumbent lease is unchanged.`,
                conflictMatrix,
                admission: finalizeProposalAdmission(baseAdmission, 'parked-for-rearbitration', {
                    reason: `An active proposal-first writer already holds '${filePath}'; compose and revalidate before granting second-writer authority.`,
                    rearbitrationRequired: true
                })
            });
        }
    }
    return composerDecision;
}
export function shouldRefineProposalScopedCidConflict(newIntent, activeIntent, baseAdmission) {
    if (!baseAdmission.requiresProposal) {
        return false;
    }
    const activeAdmission = activeIntent.admission;
    if (!activeAdmission?.requiresProposal) {
        return false;
    }
    const sharedFiles = collectSharedFiles(newIntent, activeIntent);
    if (sharedFiles.length === 0) {
        return false;
    }
    let sawDisjointComparableRegion = false;
    for (const filePath of sharedFiles) {
        const newRegions = resolveProposalRegionsForFile(newIntent, filePath);
        const activeRegions = resolveActiveProposalRegionsForFile(activeIntent, filePath);
        if (newRegions.length === 0 || activeRegions.length === 0) {
            return false;
        }
        if (findOverlappingProposalRegion(newRegions, activeRegions)) {
            return false;
        }
        sawDisjointComparableRegion = true;
    }
    return sawDisjointComparableRegion;
}
