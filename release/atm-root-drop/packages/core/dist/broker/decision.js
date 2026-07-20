import { evaluateConflictMatrix } from './conflict-matrix.js';
import { buildProposalAdmissionBase, finalizeProposalAdmission } from './decision/admission.js';
import { maybeBuildCidConflictDecompositionRequest } from './decision/decomposition.js';
import { evaluatePhysicalOverlap } from './decision/physical-overlap.js';
import { evaluateProposalOverlap, shouldRefineProposalScopedCidConflict } from './decision/proposal-overlap.js';
import { hasSharedWriteSurface } from './decision/surfaces.js';
import { withFailureReason } from './decision/failure.js';
import { findResourceOverlapMatches } from './resource-overlap.js';
function formatSharedSurfaceDetail(axis, match, activeTaskId) {
    const keyDisplay = match.leftKey === match.rightKey ? `'${match.leftKey}'` : `'${match.leftKey}' vs active '${match.rightKey}'`;
    const suffix = match.verdict === 'unknown' ? ' (possible overlap; unresolved key syntax)' : '';
    return `Shared ${axis} conflict: ${keyDisplay} is in use by task '${activeTaskId}'${suffix}`;
}
export function calculateBrokerDecision(newIntent, registry) {
    const conflicts = [];
    const taskId = newIntent.taskId;
    const conflictMatrix = evaluateConflictMatrix(newIntent, registry.activeIntents, {
        currentEpoch: registry.currentEpoch
    });
    const baseAdmission = buildProposalAdmissionBase(newIntent);
    if (conflictMatrix.arbitrationVerdict === 'takeover') {
        const decision = {
            schemaId: 'atm.brokerDecision.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
            intentId: `decision-${Date.now()}`,
            taskId,
            verdict: 'blocked-active-lease',
            lane: 'blocked',
            conflicts: [
                { kind: 'lease', detail: 'Malformed intent shape or active lease mismatch requires takeover. Abort write path and request explicit clearance.' }
            ],
            applyMethod: 'none',
            reason: 'Takeover required before conflict arbitration',
            conflictMatrix,
            admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
                reason: 'Takeover required before conflict arbitration.',
                rearbitrationRequired: true
            })
        };
        return withFailureReason(decision);
    }
    // 1. Shared Surfaces conflict check
    const sharedSurfaceAxes = [
        { axis: 'generator', conflictKind: 'generator', left: newIntent.sharedSurfaces.generators, rightOf: (a) => a.resourceKeys.generators },
        { axis: 'projection', conflictKind: 'projection', left: newIntent.sharedSurfaces.projections, rightOf: (a) => a.resourceKeys.projections },
        { axis: 'registry', conflictKind: 'registry', left: newIntent.sharedSurfaces.registries, rightOf: (a) => a.resourceKeys.registries },
        { axis: 'validator', conflictKind: 'validator', left: newIntent.sharedSurfaces.validators, rightOf: (a) => a.resourceKeys.validators },
        { axis: 'artifact', conflictKind: 'artifact', left: newIntent.sharedSurfaces.artifacts, rightOf: (a) => a.resourceKeys.artifacts }
    ];
    for (const active of registry.activeIntents) {
        if (active.taskId === taskId) {
            continue;
        }
        for (const { axis, conflictKind, left, rightOf } of sharedSurfaceAxes) {
            for (const match of findResourceOverlapMatches(axis, left, rightOf(active))) {
                conflicts.push({ kind: conflictKind, detail: formatSharedSurfaceDetail(axis, match, active.taskId) });
            }
        }
    }
    if (conflicts.length > 0) {
        const decompositionRequest = maybeBuildCidConflictDecompositionRequest(newIntent, registry.activeIntents);
        const decision = {
            schemaId: 'atm.brokerDecision.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
            intentId: `decision-${Date.now()}`,
            taskId,
            verdict: 'blocked-shared-surface',
            lane: 'blocked',
            conflicts,
            applyMethod: 'none',
            reason: 'Blocked by shared surface conflict',
            conflictMatrix,
            admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
                reason: 'Blocked by shared surface conflict before write.',
                rearbitrationRequired: baseAdmission.requiresProposal
            })
        };
        return withFailureReason(decision);
    }
    // 2. CID / read-set semantic conflicts
    const newAtomIds = new Set(newIntent.atomRefs.map((ref) => ref.atomId));
    const newAtomCids = new Set(newIntent.atomRefs.map((ref) => ref.atomCid));
    const newReadAtomIds = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomId));
    const newReadAtomCids = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomCid));
    const seenConflictKeys = new Set();
    const pushCidConflict = (kind, resourceKind, resourceValue, activeTaskId) => {
        const conflictKey = `${kind}:${resourceKind}:${resourceValue}:${activeTaskId}`;
        if (seenConflictKeys.has(conflictKey)) {
            return;
        }
        seenConflictKeys.add(conflictKey);
        conflicts.push({
            kind: 'cid',
            detail: kind === 'read'
                ? `Read-set conflict: Atom ${resourceKind} '${resourceValue}' is already written by task '${activeTaskId}'`
                : kind === 'active-read'
                    ? `Read-set conflict: Atom ${resourceKind} '${resourceValue}' is already read by active task '${activeTaskId}'`
                    : `CID conflict: Atom ${resourceKind} '${resourceValue}' is already claimed by task '${activeTaskId}'`
        });
    };
    for (const active of registry.activeIntents) {
        if (active.taskId === taskId) {
            continue;
        }
        // CID write ownership is a second-layer semantic check for a common
        // write surface. Read dependencies retain their independent visibility.
        const materialCidWrite = hasSharedWriteSurface(newIntent, active);
        const allowProposalScopedCidRefinement = shouldRefineProposalScopedCidConflict(newIntent, active, baseAdmission);
        const activeReadAtomIds = active.resourceKeys.readAtomIds ?? [];
        const activeReadAtomCids = active.resourceKeys.readAtomCids ?? [];
        for (const refId of active.resourceKeys.atomIds) {
            if (newAtomIds.has(refId) && !allowProposalScopedCidRefinement) {
                pushCidConflict('write', 'ID', refId, active.taskId);
            }
            if (newReadAtomIds.has(refId)) {
                pushCidConflict('read', 'ID', refId, active.taskId);
            }
        }
        for (const readId of activeReadAtomIds) {
            if (newAtomIds.has(readId)) {
                pushCidConflict('active-read', 'ID', readId, active.taskId);
            }
        }
        for (const refCid of active.resourceKeys.atomCids) {
            if (materialCidWrite && newAtomCids.has(refCid) && !allowProposalScopedCidRefinement) {
                pushCidConflict('write', 'CID', refCid, active.taskId);
            }
            if (newReadAtomCids.has(refCid)) {
                pushCidConflict('read', 'CID', refCid, active.taskId);
            }
        }
        for (const readCid of activeReadAtomCids) {
            if (newAtomCids.has(readCid)) {
                pushCidConflict('active-read', 'CID', readCid, active.taskId);
            }
        }
    }
    if (conflicts.length > 0) {
        const decompositionRequest = maybeBuildCidConflictDecompositionRequest(newIntent, registry.activeIntents);
        const decision = {
            schemaId: 'atm.brokerDecision.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
            intentId: `decision-${Date.now()}`,
            taskId,
            verdict: 'blocked-cid-conflict',
            lane: 'blocked',
            conflicts,
            applyMethod: 'none',
            reason: 'Blocked by Atom ID, CID, or read-set semantic conflict',
            conflictMatrix,
            ...(decompositionRequest ? { decompositionRequest } : {}),
            admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
                reason: 'Blocked by Atom ID, CID, or read-set semantic conflict before write.',
                rearbitrationRequired: baseAdmission.requiresProposal
            })
        };
        return withFailureReason(decision);
    }
    const proposalOverlapDecision = evaluateProposalOverlap(newIntent, registry.activeIntents, baseAdmission, conflictMatrix);
    if (proposalOverlapDecision) {
        return proposalOverlapDecision;
    }
    // 3. Physical file overlap checks
    const fileOverlapResult = evaluatePhysicalOverlap(newIntent, registry.activeIntents);
    if (fileOverlapResult != null) {
        const decision = {
            schemaId: 'atm.brokerDecision.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
            intentId: `decision-${Date.now()}`,
            taskId,
            verdict: 'needs-physical-split',
            lane: 'deterministic-composer',
            conflicts: fileOverlapResult.conflicts,
            applyMethod: 'patch-apply',
            reason: fileOverlapResult.reason,
            conflictMatrix,
            admission: finalizeProposalAdmission(baseAdmission, 'composer-routed', {
                reason: 'Same-file work requires proposal-aware composer routing before write.',
                rearbitrationRequired: true
            })
        };
        if (fileOverlapResult.decompositionRequest) {
            return withFailureReason({
                ...decision,
                decompositionRequest: fileOverlapResult.decompositionRequest
            });
        }
        return withFailureReason(decision);
    }
    // 4. Allowed path
    return withFailureReason({
        schemaId: 'atm.brokerDecision.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
        intentId: `decision-${Date.now()}`,
        taskId,
        verdict: 'parallel-safe',
        lane: 'direct-brokered',
        conflicts: [],
        applyMethod: 'none',
        reason: 'Parallel safe',
        conflictMatrix,
        admission: finalizeProposalAdmission(baseAdmission, baseAdmission.requiresProposal ? 'provisional-write-lease' : 'write-admitted', {
            reason: baseAdmission.requiresProposal
                ? 'Proposal-first lane is active; broker recorded a provisional write lease before final admission.'
                : 'No proposal-first trigger is active; direct brokered write is admitted.'
        })
    });
}
