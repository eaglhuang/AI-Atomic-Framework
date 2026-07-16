import type {
  BrokerDecision,
  ConflictDetail,
  WriteBrokerRegistryDocument,
  WriteIntent
} from './types.ts';
import { evaluateConflictMatrix } from './conflict-matrix.ts';
import { buildProposalAdmissionBase, finalizeProposalAdmission } from './decision/admission.ts';
import { maybeBuildCidConflictDecompositionRequest } from './decision/decomposition.ts';
import { evaluatePhysicalOverlap } from './decision/physical-overlap.ts';
import { evaluateProposalOverlap, shouldRefineProposalScopedCidConflict } from './decision/proposal-overlap.ts';
import { hasSharedWriteSurface } from './decision/surfaces.ts';
import { withFailureReason } from './decision/failure.ts';

export function calculateBrokerDecision(
  newIntent: WriteIntent,
  registry: WriteBrokerRegistryDocument
): BrokerDecision {
  const conflicts: ConflictDetail[] = [];
  const taskId = newIntent.taskId;
  const conflictMatrix = evaluateConflictMatrix(newIntent, registry.activeIntents, {
    currentEpoch: registry.currentEpoch
  });
  const baseAdmission = buildProposalAdmissionBase(newIntent);

  if (conflictMatrix.arbitrationVerdict === 'takeover') {
    const decision: BrokerDecision = {
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
  const newGenerators = new Set(newIntent.sharedSurfaces.generators);
  const newProjections = new Set(newIntent.sharedSurfaces.projections);
  const newRegistries = new Set(newIntent.sharedSurfaces.registries);
  const newValidators = new Set(newIntent.sharedSurfaces.validators);
  const newArtifacts = new Set(newIntent.sharedSurfaces.artifacts);

  for (const active of registry.activeIntents) {
    if (active.taskId === taskId) {
      continue;
    }

    for (const generator of active.resourceKeys.generators) {
      if (newGenerators.has(generator)) {
        conflicts.push({ kind: 'generator', detail: `Shared generator conflict: '${generator}' is in use by task '${active.taskId}'` });
      }
    }
    for (const projection of newProjections) {
      if (active.resourceKeys.projections.includes(projection)) {
        conflicts.push({ kind: 'projection', detail: `Shared projection conflict: '${projection}' is in use by task '${active.taskId}'` });
      }
    }
    for (const registryKey of newRegistries) {
      if (active.resourceKeys.registries.includes(registryKey)) {
        conflicts.push({ kind: 'registry', detail: `Shared registry conflict: '${registryKey}' is in use by task '${active.taskId}'` });
      }
    }
    for (const validator of newValidators) {
      if (active.resourceKeys.validators.includes(validator)) {
        conflicts.push({ kind: 'validator', detail: `Shared validator conflict: '${validator}' is in use by task '${active.taskId}'` });
      }
    }
    for (const artifact of newArtifacts) {
      if (active.resourceKeys.artifacts.includes(artifact)) {
        conflicts.push({ kind: 'artifact', detail: `Shared artifact conflict: '${artifact}' is in use by task '${active.taskId}'` });
      }
    }
  }

  if (conflicts.length > 0) {
    const decompositionRequest = maybeBuildCidConflictDecompositionRequest(newIntent, registry.activeIntents);
    const decision: BrokerDecision = {
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
  const seenConflictKeys = new Set<string>();

  const pushCidConflict = (
    kind: 'write' | 'read' | 'active-read',
    resourceKind: 'ID' | 'CID',
    resourceValue: string,
    activeTaskId: string
  ) => {
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
      if (materialCidWrite && newAtomIds.has(refId) && !allowProposalScopedCidRefinement) {
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
    const decision: BrokerDecision = {
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
    const decision: BrokerDecision = {
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
    admission: finalizeProposalAdmission(
      baseAdmission,
      baseAdmission.requiresProposal ? 'provisional-write-lease' : 'write-admitted',
      {
        reason: baseAdmission.requiresProposal
          ? 'Proposal-first lane is active; broker recorded a provisional write lease before final admission.'
          : 'No proposal-first trigger is active; direct brokered write is admitted.'
      }
    )
  });
}
