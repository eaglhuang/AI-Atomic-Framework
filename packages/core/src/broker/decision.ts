import type { WriteIntent, WriteBrokerRegistryDocument, BrokerDecision, ConflictDetail } from './types.ts';

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
    for (const p of active.resourceKeys.projections) {
      if (newProjections.has(p)) {
        conflicts.push({ kind: 'projection', detail: `Shared projection conflict: '${p}' is in use by task '${active.taskId}'` });
      }
    }
    for (const r of active.resourceKeys.registries) {
      if (newRegistries.has(r)) {
        conflicts.push({ kind: 'registry', detail: `Shared registry conflict: '${r}' is in use by task '${active.taskId}'` });
      }
    }
    for (const v of active.resourceKeys.validators) {
      if (newValidators.has(v)) {
        conflicts.push({ kind: 'validator', detail: `Shared validator conflict: '${v}' is in use by task '${active.taskId}'` });
      }
    }
    for (const a of active.resourceKeys.artifacts) {
      if (newArtifacts.has(a)) {
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

  const pushCidConflict = (kind: 'write' | 'read', resourceKind: 'ID' | 'CID', resourceValue: string, activeTaskId: string) => {
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
      continue; // 同一個 task 內部不視為碰撞
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

  // 3. 檢查 Physical File overlap (同檔但 CID disjoint)
  const newFiles = new Set(newIntent.targetFiles);
  const overlappingFiles: string[] = [];

  for (const active of registry.activeIntents) {
    if (active.taskId === taskId) {
      continue;
    }

    for (const f of active.resourceKeys.files) {
      if (newFiles.has(f)) {
        overlappingFiles.push(f);
      }
    }
  }

  if (overlappingFiles.length > 0) {
    return {
      schemaId: 'atm.brokerDecision.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
      intentId: `decision-${Date.now()}`,
      taskId,
      verdict: 'needs-physical-split',
      lane: 'deterministic-composer',
      conflicts: overlappingFiles.map(f => ({
        kind: 'file-range',
        detail: `Physical file overlap on '${f}'`
      })),
      applyMethod: 'patch-apply',
      reason: 'File overlap detected but CIDs are disjoint; routed to deterministic-composer'
    };
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
