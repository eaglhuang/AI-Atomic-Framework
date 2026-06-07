import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WriteBrokerRegistryDocument, WriteIntent, ActiveWriteIntent } from './types.ts';

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
