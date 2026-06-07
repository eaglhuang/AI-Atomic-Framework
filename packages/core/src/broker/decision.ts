import type { WriteIntent, WriteBrokerRegistryDocument, BrokerDecision, ConflictDetail } from './types.ts';

export function calculateBrokerDecision(
  newIntent: WriteIntent,
  registry: WriteBrokerRegistryDocument
): BrokerDecision {
  const conflicts: ConflictDetail[] = [];
  const taskId = newIntent.taskId;

  // 1. 檢查 CID 衝突
  const newAtomIds = new Set(newIntent.atomRefs.map(r => r.atomId));
  const newAtomCids = new Set(newIntent.atomRefs.map(r => r.atomCid));

  for (const active of registry.activeIntents) {
    if (active.taskId === taskId) {
      continue; // 同一個 task 內部不視為碰撞
    }

    // 檢查 atomId 重疊
    for (const refId of active.resourceKeys.atomIds) {
      if (newAtomIds.has(refId)) {
        conflicts.push({
          kind: 'cid',
          detail: `CID conflict: Atom ID '${refId}' is already claimed by task '${active.taskId}'`
        });
      }
    }

    // 檢查 atomCid 重疊
    for (const refCid of active.resourceKeys.atomCids) {
      if (newAtomCids.has(refCid)) {
        conflicts.push({
          kind: 'cid',
          detail: `CID conflict: Atom CID '${refCid}' is already claimed by task '${active.taskId}'`
        });
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
      reason: 'Blocked by Atom ID or CID semantic conflict'
    };
  }

  // 2. 檢查 Shared Surfaces 衝突
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
