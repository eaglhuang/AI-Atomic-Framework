import type { ActiveWriteIntent, BrokerDecision, ConflictDetail, DecompositionRequest, DecompositionTargetFunction, LineRange, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';
import { DEFAULT_AGR_LAYER2_THRESHOLDS, shouldTriggerLayer2 } from './policy.ts';
import { intersectRanges, normalizeLineRange, rangesOverlap, type Layer2Conflict, type VirtualAtomCandidate } from './agr.ts';

export function calculateBrokerDecision(
  newIntent: WriteIntent,
  registry: WriteBrokerRegistryDocument
): BrokerDecision {
  const conflicts: ConflictDetail[] = [];
  const taskId = newIntent.taskId;

  // 1. 檢查 Shared Surfaces 衝突
  const newGenerators = new Set(newIntent.sharedSurfaces.generators);
  const newProjections = new Set(newIntent.sharedSurfaces.projections);
  const newRegistries = new Set(newIntent.sharedSurfaces.registries);
  const newValidators = new Set(newIntent.sharedSurfaces.validators);
  const newArtifacts = new Set(newIntent.sharedSurfaces.artifacts);

  for (const active of registry.activeIntents) {
    if (active.taskId === taskId) {
      continue;
    }

    for (const g of active.resourceKeys.generators) {
      if (newGenerators.has(g)) {
        conflicts.push({ kind: 'generator', detail: `Shared generator conflict: '${g}' is in use by task '${active.taskId}'` });
      }
    }
    for (const p of newProjections) {
      if (active.resourceKeys.projections.includes(p)) {
        conflicts.push({ kind: 'projection', detail: `Shared projection conflict: '${p}' is in use by task '${active.taskId}'` });
      }
    }
    for (const r of newRegistries) {
      if (active.resourceKeys.registries.includes(r)) {
        conflicts.push({ kind: 'registry', detail: `Shared registry conflict: '${r}' is in use by task '${active.taskId}'` });
      }
    }
    for (const v of newValidators) {
      if (active.resourceKeys.validators.includes(v)) {
        conflicts.push({ kind: 'validator', detail: `Shared validator conflict: '${v}' is in use by task '${active.taskId}'` });
      }
    }
    for (const a of newArtifacts) {
      if (active.resourceKeys.artifacts.includes(a)) {
        conflicts.push({ kind: 'artifact', detail: `Shared artifact conflict: '${a}' is in use by task '${active.taskId}'` });
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      schemaId: 'atm.brokerDecision.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
      intentId: `decision-${Date.now()}`,
      taskId,
      verdict: 'blocked-shared-surface',
      lane: 'blocked',
      conflicts,
      applyMethod: 'none',
      reason: 'Blocked by shared surface conflict'
    };
  }

  // 2. 檢查 CID / read-set 衝突
  const newAtomIds = new Set(newIntent.atomRefs.map((ref) => ref.atomId));
  const newAtomCids = new Set(newIntent.atomRefs.map((ref) => ref.atomCid));
  const newReadAtomIds = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomId));
  const newReadAtomCids = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomCid));
  const seenConflictKeys = new Set<string>();

  const pushCidConflict = (
    kind: 'write' | 'read',
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
        : `CID conflict: Atom ${resourceKind} '${resourceValue}' is already claimed by task '${activeTaskId}'`
    });
  };

  for (const active of registry.activeIntents) {
    if (active.taskId === taskId) {
      continue;
    }

    for (const refId of active.resourceKeys.atomIds) {
      if (newAtomIds.has(refId)) {
        pushCidConflict('write', 'ID', refId, active.taskId);
      }
      if (newReadAtomIds.has(refId)) {
        pushCidConflict('read', 'ID', refId, active.taskId);
      }
    }

    for (const refCid of active.resourceKeys.atomCids) {
      if (newAtomCids.has(refCid)) {
        pushCidConflict('write', 'CID', refCid, active.taskId);
      }
      if (newReadAtomCids.has(refCid)) {
        pushCidConflict('read', 'CID', refCid, active.taskId);
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      schemaId: 'atm.brokerDecision.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
      intentId: `decision-${Date.now()}`,
      taskId,
      verdict: 'blocked-cid-conflict',
      lane: 'blocked',
      conflicts,
      applyMethod: 'none',
      reason: 'Blocked by Atom ID, CID, or read-set semantic conflict'
    };
  }

  // 3. 檢查 physical file overlap (同檔但CID disjoint)
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
      reason: fileOverlapResult.reason
    };

    if (fileOverlapResult.decompositionRequest) {
      return {
        ...decision,
        decompositionRequest: fileOverlapResult.decompositionRequest
      };
    }

    return decision;
  }

  // 4. 無衝突
  return {
    schemaId: 'atm.brokerDecision.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
    intentId: `decision-${Date.now()}`,
    taskId,
    verdict: 'parallel-safe',
    lane: 'direct-brokered',
    conflicts: [],
    applyMethod: 'none',
    reason: 'Parallel safe'
  };
}

interface PhysicalOverlapResult {
  readonly conflicts: ConflictDetail[];
  readonly reason: string;
  readonly decompositionRequest?: DecompositionRequest;
}

function evaluatePhysicalOverlap(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): PhysicalOverlapResult | null {
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
  conflictRegion: LineRange
): DecompositionRequest {
  return {
    targetFunction,
    conflictRegion,
    constraint: 'preserve-signature'
  };
}
