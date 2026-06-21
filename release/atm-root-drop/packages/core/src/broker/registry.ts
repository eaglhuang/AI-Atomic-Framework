import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';

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
      currentEpoch: Date.now(),
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
      currentEpoch: Date.now(),
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
  ttlSeconds = 1800,
  admissionOverride?: ActiveWriteIntent['admission']
): WriteBrokerRegistryDocument {
  const leaseSeconds = resolveLeaseSeconds(intent, ttlSeconds);
  const leaseMaxSeconds = resolveLeaseMaxSeconds(intent, ttlSeconds);
  const cleanedIntents = doc.activeIntents.filter((entry) => entry.taskId !== intent.taskId);
  const epoch = Date.now();
  const now = new Date().toISOString();
  const expiresAt = new Date(epoch + leaseSeconds * 1000).toISOString();

  const newActive: ActiveWriteIntent = {
    intentId: `intent-${epoch}`,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
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
    leaseEpoch: epoch,
    leaseSeconds,
    leaseMaxSeconds,
    heartbeatAt: now,
    lane,
    expiresAt,
    admission: admissionOverride
      ? {
          ...admissionOverride,
          hotFiles: [...(admissionOverride.hotFiles ?? [])],
          boundedRegions: [...(admissionOverride.boundedRegions ?? [])]
        }
      : intent.proposalAdmission
        ? {
            trigger: intent.proposalAdmission.trigger,
            state: intent.proposalAdmission.summarySubmitted ? 'proposal-submitted' : 'proposal-submitted',
            requiresProposal: intent.proposalAdmission.trigger !== 'not-required',
            summarySubmitted: intent.proposalAdmission.summarySubmitted,
            hotFiles: [...(intent.proposalAdmission.hotFiles ?? [])],
            boundedRegions: [...(intent.proposalAdmission.boundedRegions ?? [])],
            rearbitrationRequired: false,
            reason: intent.proposalAdmission.notes?.trim() || 'Registered proposal admission request.'
          }
        : undefined
  };

  return {
    ...doc,
    currentEpoch: epoch,
    activeIntents: [...cleanedIntents, newActive]
  };
}

export function renewIntentLease(
  doc: WriteBrokerRegistryDocument,
  taskId: string,
  actorId: string,
  ttlSeconds = 1800
): WriteBrokerRegistryDocument {
  const target = doc.activeIntents.find((intent) => intent.taskId === taskId && intent.actorId === actorId);
  if (!target) {
    return doc;
  }

  const leaseSeconds = Math.min(Math.max(1, Math.floor(ttlSeconds)), target.leaseMaxSeconds);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();

  return {
    ...doc,
    currentEpoch: Date.now(),
    activeIntents: doc.activeIntents.map((intent) => {
      if (intent.intentId !== target.intentId) return intent;
      return {
        ...intent,
        leaseEpoch: Date.now(),
        leaseSeconds,
        heartbeatAt: now,
        expiresAt
      };
    })
  };
}

export function releaseTask(
  doc: WriteBrokerRegistryDocument,
  taskId: string
): WriteBrokerRegistryDocument {
  return {
    ...doc,
    currentEpoch: Date.now(),
    activeIntents: doc.activeIntents.filter((entry) => entry.taskId !== taskId)
  };
}

export function cleanupStale(
  doc: WriteBrokerRegistryDocument
): WriteBrokerRegistryDocument {
  const now = Date.now();
  const validIntents = doc.activeIntents.filter((entry) => {
    if (!entry.expiresAt) return true;
    const exp = Date.parse(entry.expiresAt);
    return exp > now;
  });
  const validEpochs = validIntents
    .map((entry) => entry.leaseEpoch)
    .filter((epoch) => Number.isFinite(epoch));
  const preservedEpoch = validEpochs.length > 0
    ? Math.max(...validEpochs)
    : (typeof doc.currentEpoch === 'number' && Number.isFinite(doc.currentEpoch) ? doc.currentEpoch : now);

  return {
    ...doc,
    currentEpoch: preservedEpoch,
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

function resolveLeaseSeconds(intent: WriteIntent, ttlSeconds: number): number {
  const requested = Math.max(1, Math.floor(intent.leaseBounds?.requestedSeconds ?? ttlSeconds));
  const maxSeconds = resolveLeaseMaxSeconds(intent, ttlSeconds);
  if (requested > maxSeconds) {
    throw new RangeError(`Requested leaseSeconds ${requested} exceeds leaseMaxSeconds ${maxSeconds}.`);
  }
  return requested;
}

function resolveLeaseMaxSeconds(intent: WriteIntent, ttlSeconds: number): number {
  return Math.max(1, Math.floor(intent.leaseBounds?.maxSeconds ?? ttlSeconds));
}
