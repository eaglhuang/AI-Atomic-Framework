import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WriteBrokerRegistryDocument, WriteIntent, ActiveWriteIntent } from './types.ts';

export interface VirtualAtomInUseRecord {
  readonly virtualAtomId: string;
  readonly virtualAtomCid: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly intentId: string;
  readonly lane: ActiveWriteIntent['lane'];
  readonly leaseEpoch: number;
  readonly expiresAt: string | null;
  readonly sourceAtomIds: readonly string[];
}

export interface VirtualAtomInUseRegistryDocument {
  readonly schemaId: 'atm.virtualAtomInUseRegistry.v1';
  readonly specVersion: '0.1.0';
  readonly repoId: string;
  readonly workspaceId: string;
  readonly activeVirtualAtoms: readonly VirtualAtomInUseRecord[];
  readonly activeIntents: readonly ActiveWriteIntent[];
}

export function loadRegistry(filePath: string): WriteBrokerRegistryDocument {
  if (!existsSync(filePath)) {
    return {
      schemaId: 'atm.writeBrokerRegistry.v1',
      specVersion: '0.1.0',
      repoId: 'local-repo',
      workspaceId: 'main',
      activeIntents: []
    };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as WriteBrokerRegistryDocument;
  } catch {
    return {
      schemaId: 'atm.writeBrokerRegistry.v1',
      specVersion: '0.1.0',
      repoId: 'local-repo',
      workspaceId: 'main',
      activeIntents: []
    };
  }
}

export function saveRegistry(filePath: string, doc: WriteBrokerRegistryDocument): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
}

export function registerIntent(
  doc: WriteBrokerRegistryDocument,
  intent: WriteIntent,
  lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked',
  ttlSeconds = 1800
): WriteBrokerRegistryDocument {
  // 先把該 taskId 既有的 intents 移除，避免重複
  const cleanedIntents = doc.activeIntents.filter(i => i.taskId !== intent.taskId);

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const newActive: ActiveWriteIntent = {
    intentId: `intent-${Date.now()}`,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map(r => r.atomId),
      atomCids: intent.atomRefs.map(r => r.atomCid),
      atomRanges: intent.atomRefs
        .map((ref) => ({
          filePath: ref.sourceRange?.filePath ?? '',
          lineStart: ref.sourceRange?.lineStart ?? 0,
          lineEnd: ref.sourceRange?.lineEnd ?? 0,
          atomCid: ref.atomCid
        }))
        .filter((entry) => entry.filePath && entry.lineStart > 0 && entry.lineEnd > 0),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: Date.now(),
    lane,
    expiresAt
  };

  return {
    ...doc,
    activeIntents: [...cleanedIntents, newActive]
  };
}

export function releaseTask(
  doc: WriteBrokerRegistryDocument,
  taskId: string
): WriteBrokerRegistryDocument {
  return {
    ...doc,
    activeIntents: doc.activeIntents.filter(i => i.taskId !== taskId)
  };
}

export function cleanupStale(
  doc: WriteBrokerRegistryDocument
): WriteBrokerRegistryDocument {
  const now = Date.now();
  const validIntents = doc.activeIntents.filter(i => {
    if (!i.expiresAt) return true;
    const exp = Date.parse(i.expiresAt);
    return exp > now;
  });

  return {
    ...doc,
    activeIntents: validIntents
  };
}

export function buildVirtualAtomInUseRegistry(doc: WriteBrokerRegistryDocument): VirtualAtomInUseRegistryDocument {
  const activeVirtualAtoms: VirtualAtomInUseRecord[] = [];

  for (const intent of doc.activeIntents) {
    const atomIds = intent.resourceKeys.atomIds;
    const atomCids = intent.resourceKeys.atomCids;
    if (atomIds.length === 0) continue;

    for (let index = 0; index < atomIds.length; index += 1) {
      const virtualAtomId = atomIds[index]?.trim();
      if (!virtualAtomId) continue;
      const virtualAtomCid = atomCids[index]?.trim() || virtualAtomId.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      activeVirtualAtoms.push({
        virtualAtomId,
        virtualAtomCid,
        taskId: intent.taskId,
        actorId: intent.actorId,
        intentId: intent.intentId,
        lane: intent.lane,
        leaseEpoch: intent.leaseEpoch,
        expiresAt: intent.expiresAt ?? null,
        sourceAtomIds: atomIds.map((entry) => entry.trim()).filter(Boolean)
      });
    }
  }

  activeVirtualAtoms.sort((left, right) => {
    const atomOrder = left.virtualAtomId.localeCompare(right.virtualAtomId);
    if (atomOrder !== 0) return atomOrder;
    const taskOrder = left.taskId.localeCompare(right.taskId);
    if (taskOrder !== 0) return taskOrder;
    return left.intentId.localeCompare(right.intentId);
  });

  return {
    schemaId: 'atm.virtualAtomInUseRegistry.v1',
    specVersion: '0.1.0',
    repoId: doc.repoId,
    workspaceId: doc.workspaceId,
    activeVirtualAtoms,
    activeIntents: doc.activeIntents
  };
}
