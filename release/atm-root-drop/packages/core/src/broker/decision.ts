import type {
  ActiveWriteIntent,
  BrokerConflictMatrix,
  BrokerDecision,
  ConflictDetail,
  DecompositionRequest,
  DecompositionTargetFunction,
  LineRange,
  ProposalAdmissionBoundedRegion,
  ProposalAdmissionEvidence,
  ProposalAdmissionRequest,
  ProposalAdmissionState,
  SuggestedSplitAtom,
  WriteBrokerRegistryDocument,
  WriteIntent
} from './types.ts';
import { evaluateConflictMatrix } from './conflict-matrix.ts';
import { DEFAULT_AGR_LAYER2_THRESHOLDS, shouldTriggerLayer2 } from './policy.ts';
import { intersectRanges, normalizeLineRange, rangesOverlap, type Layer2Conflict, type VirtualAtomCandidate } from './agr.ts';
import { buildBrokerDecisionFailureReason } from './failure-reason.ts';

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

function hasSharedWriteSurface(intent: WriteIntent, active: ActiveWriteIntent): boolean {
  const normalizedFiles = new Set(intent.targetFiles.map(normalizeBrokerPath));
  if (active.resourceKeys.files.some((file) => normalizedFiles.has(normalizeBrokerPath(file)))) return true;
  return hasIntersection(intent.sharedSurfaces.generators, active.resourceKeys.generators)
    || hasIntersection(intent.sharedSurfaces.projections, active.resourceKeys.projections)
    || hasIntersection(intent.sharedSurfaces.registries, active.resourceKeys.registries)
    || hasIntersection(intent.sharedSurfaces.validators, active.resourceKeys.validators)
    || hasIntersection(intent.sharedSurfaces.artifacts, active.resourceKeys.artifacts);
}

function hasIntersection(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function normalizeBrokerPath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

function withFailureReason(decision: BrokerDecision): BrokerDecision {
  const failureReason = buildBrokerDecisionFailureReason(decision);
  return failureReason ? { ...decision, failureReason } : decision;
}

function buildProposalAdmissionBase(intent: WriteIntent): ProposalAdmissionEvidence {
  const request = intent.proposalAdmission ?? defaultProposalAdmissionRequest();
  return {
    trigger: request.trigger,
    state: 'not-required',
    requiresProposal: request.trigger !== 'not-required',
    summarySubmitted: request.summarySubmitted,
    hotFiles: normalizeStringList(request.hotFiles ?? []),
    boundedRegions: normalizeBoundedRegions(request.boundedRegions ?? []),
    rearbitrationRequired: false,
    reason: request.notes?.trim() || 'No proposal admission trigger is active.'
  };
}

function finalizeProposalAdmission(
  base: ProposalAdmissionEvidence,
  preferredState: ProposalAdmissionState,
  overrides: {
    readonly reason: string;
    readonly rearbitrationRequired?: boolean;
  }
): ProposalAdmissionEvidence {
  const state = !base.requiresProposal
    ? preferredState === 'blocked-before-write' || preferredState === 'composer-routed'
      ? preferredState
      : 'not-required'
    : base.summarySubmitted
      ? preferredState
      : preferredState === 'blocked-before-write'
        ? 'blocked-before-write'
        : 'proposal-submitted';
  return {
    ...base,
    state,
    rearbitrationRequired: overrides.rearbitrationRequired ?? false,
    reason: overrides.reason
  };
}

function defaultProposalAdmissionRequest(): ProposalAdmissionRequest {
  return {
    trigger: 'not-required',
    summarySubmitted: false
  };
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeBoundedRegions(values: readonly ProposalAdmissionBoundedRegion[]): readonly ProposalAdmissionBoundedRegion[] {
  return values
    .filter((value) => value.filePath && value.lineStart > 0 && value.lineEnd >= value.lineStart)
    .map((value) => ({
      filePath: value.filePath,
      lineStart: value.lineStart,
      lineEnd: value.lineEnd
    }))
    .sort((left, right) => {
      const fileOrder = left.filePath.localeCompare(right.filePath);
      if (fileOrder !== 0) return fileOrder;
      const startOrder = left.lineStart - right.lineStart;
      if (startOrder !== 0) return startOrder;
      return left.lineEnd - right.lineEnd;
    });
}

interface PhysicalOverlapResult {
  readonly conflicts: ConflictDetail[];
  readonly reason: string;
  readonly decompositionRequest?: DecompositionRequest;
}

function evaluatePhysicalOverlap(
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

function evaluateProposalOverlap(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[],
  baseAdmission: ProposalAdmissionEvidence,
  conflictMatrix: BrokerConflictMatrix
): BrokerDecision | null {
  if (!baseAdmission.requiresProposal) {
    return null;
  }

  for (const activeIntent of activeIntents) {
    if (activeIntent.taskId === newIntent.taskId) {
      continue;
    }

    const sharedFiles = newIntent.targetFiles.filter((filePath) => activeIntent.resourceKeys.files.includes(filePath));
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
          reason: `Second writer must wait; active writer '${activeIntent.taskId}' should be parked for rearbitration before same-region write.`,
          conflictMatrix,
          admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
            reason: `Proposal overlap detected on the same bounded region for '${filePath}'; rearbitration is required before any write is admitted.`,
            rearbitrationRequired: true
          })
          })
        };
      }

      if (newRegions.length > 0 && activeRegions.length > 0) {
        return withFailureReason({
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
      }

      return withFailureReason({
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
        reason: `Active proposal-first writer '${activeIntent.taskId}' should be parked while broker rearbitrates same-file work on '${filePath}'.`,
        conflictMatrix,
        admission: finalizeProposalAdmission(baseAdmission, 'parked-for-rearbitration', {
          reason: `An active proposal-first writer already holds '${filePath}'; park and rearbitrate before granting second-writer authority.`,
          rearbitrationRequired: true
        })
      });
    }
  }

  return null;
}

function resolveProposalRegionsForFile(intent: WriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const fromAdmission = (intent.proposalAdmission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  if (fromAdmission.length > 0) {
    return normalizeBoundedRegions(fromAdmission);
  }
  return normalizeBoundedRegions(
    intent.atomRefs
      .filter((ref) => ref.sourceRange?.filePath === filePath)
      .map((ref) => ({
        filePath,
        lineStart: ref.sourceRange!.lineStart,
        lineEnd: ref.sourceRange!.lineEnd
      }))
  );
}

function resolveActiveProposalRegionsForFile(intent: ActiveWriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const fromAdmission = (intent.admission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  if (fromAdmission.length > 0) {
    return normalizeBoundedRegions(fromAdmission);
  }
  return normalizeBoundedRegions(
    (intent.resourceKeys.atomRanges ?? [])
      .filter((range) => range.filePath === filePath)
      .map((range) => ({
        filePath,
        lineStart: range.lineStart,
        lineEnd: range.lineEnd
      }))
  );
}

function findOverlappingProposalRegion(
  left: readonly ProposalAdmissionBoundedRegion[],
  right: readonly ProposalAdmissionBoundedRegion[]
): ProposalAdmissionBoundedRegion | null {
  for (const leftRegion of left) {
    for (const rightRegion of right) {
      if (leftRegion.filePath !== rightRegion.filePath) {
        continue;
      }
      if (leftRegion.lineStart <= rightRegion.lineEnd && rightRegion.lineStart <= leftRegion.lineEnd) {
        return {
          filePath: leftRegion.filePath,
          lineStart: Math.max(leftRegion.lineStart, rightRegion.lineStart),
          lineEnd: Math.min(leftRegion.lineEnd, rightRegion.lineEnd)
        };
      }
    }
  }
  return null;
}

function shouldRefineProposalScopedCidConflict(
  newIntent: WriteIntent,
  activeIntent: ActiveWriteIntent,
  baseAdmission: ProposalAdmissionEvidence
): boolean {
  if (!baseAdmission.requiresProposal) {
    return false;
  }

  const activeAdmission = activeIntent.admission;
  if (!activeAdmission?.requiresProposal) {
    return false;
  }

  const sharedFiles = newIntent.targetFiles.filter((filePath) => activeIntent.resourceKeys.files.includes(filePath));
  if (sharedFiles.length === 0) {
    return false;
  }

  let sawDisjointComparableRegion = false;
  for (const filePath of sharedFiles) {
    const newRegions = resolveProposalRegionsForFile(newIntent, filePath);
    const activeRegions = resolveActiveProposalRegionsForFile(activeIntent, filePath);
    if (newRegions.length === 0 || activeRegions.length === 0) {
      continue;
    }
    if (findOverlappingProposalRegion(newRegions, activeRegions)) {
      return false;
    }
    sawDisjointComparableRegion = true;
  }

  return sawDisjointComparableRegion;
}

function toVirtualAtoms(intent: WriteIntent): VirtualAtomCandidate[] {
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

function toVirtualAtomRangesFromActiveIntent(intent: ActiveWriteIntent): VirtualAtomCandidate[] {
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

function buildLayer2ConflictDetail(region: LineRange): ConflictDetail {
  return {
    kind: 'file-range',
    detail: `Layer2 overlap detected on '${region.filePath}' in lines [${region.lineStart}-${region.lineEnd}]`
  };
}

function buildDecompositionRequest(
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

function maybeBuildCidConflictDecompositionRequest(
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

function buildSuggestedSplitAtoms(
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

function toSuggestedAtomCid(atomId: string, role: SuggestedSplitAtom['role'], range: LineRange): string {
  return `${atomId}-${role}-${range.lineStart}-${range.lineEnd}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
