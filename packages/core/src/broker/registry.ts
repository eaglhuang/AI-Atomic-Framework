import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { classifyLeasePhase } from './orphan-cleanup.ts';
import type { ActiveWriteIntent, BrokerDecision, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';

export const DEFAULT_BROKER_CLEANUP_COMMAND = 'node atm.mjs broker cleanup --json';

export type StaleRegistryEntryClassification =
  | 'expired-lease'
  | 'stale-heartbeat'
  | 'suspect-heartbeat'
  | 'active-lease';

export interface StaleRegistryEntryEvidence {
  readonly intentId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly owner: string;
  readonly registryPath: string | null;
  readonly expiresAt: string | null;
  readonly heartbeatAt: string | null;
  readonly ageMs: number;
  readonly ageLabel: string;
  readonly classification: StaleRegistryEntryClassification;
  readonly reason: string;
  readonly terminalResidue: boolean;
}

export interface CleanupStaleResult {
  readonly registry: WriteBrokerRegistryDocument;
  readonly removed: readonly StaleRegistryEntryEvidence[];
  readonly removedCount: number;
  readonly cleanupCommand: string;
  readonly guidance: string;
}

export interface CleanupStaleOptions {
  readonly now?: number;
  readonly registryPath?: string | null;
}

export interface LoadRegistryOptions {
  /** When false, stale entries are reported but not persisted during load. Default: true. */
  readonly persistCleanup?: boolean;
}

export interface BlockingRegistryFindingEvidence {
  readonly registryPath: string;
  readonly blocking: StaleRegistryEntryEvidence;
  readonly detail: string;
  readonly cleanupCommand: string;
  readonly guidance: string;
  readonly isStale: boolean;
}

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

export function loadRegistry(filePath: string, options: LoadRegistryOptions = {}): WriteBrokerRegistryDocument {
  const persistCleanup = options.persistCleanup !== false;
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
    const parsed = JSON.parse(raw) as WriteBrokerRegistryDocument;
    const cleaned = cleanupStaleWithEvidence(parsed, { registryPath: filePath });
    if (
      persistCleanup
      && (cleaned.removedCount > 0 || cleaned.registry.currentEpoch !== parsed.currentEpoch)
    ) {
      saveRegistry(filePath, cleaned.registry);
    }
    return cleaned.registry;
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
      readAtomIds: (intent.readAtoms ?? []).map((ref) => ref.atomId),
      readAtomCids: (intent.readAtoms ?? []).map((ref) => ref.atomCid),
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
  doc: WriteBrokerRegistryDocument,
  options: CleanupStaleOptions = {}
): WriteBrokerRegistryDocument {
  return cleanupStaleWithEvidence(doc, options).registry;
}

export function cleanupStaleWithEvidence(
  doc: WriteBrokerRegistryDocument,
  options: CleanupStaleOptions = {}
): CleanupStaleResult {
  const now = options.now ?? Date.now();
  const registryPath = options.registryPath ?? null;
  const removed: StaleRegistryEntryEvidence[] = [];
  const validIntents: ActiveWriteIntent[] = [];

  for (const entry of doc.activeIntents) {
    const phase = classifyLeasePhase(entry, now);
    if (phase === 'stale') {
      removed.push(describeStaleRegistryEntry(entry, { now, registryPath }));
      continue;
    }
    validIntents.push(entry);
  }

  const validEpochs = validIntents
    .map((entry) => entry.leaseEpoch)
    .filter((epoch) => Number.isFinite(epoch));
  const preservedEpoch = validEpochs.length > 0
    ? Math.max(...validEpochs)
    : (typeof doc.currentEpoch === 'number' && Number.isFinite(doc.currentEpoch) ? doc.currentEpoch : now);

  const cleanupCommand = buildBrokerCleanupCommand(registryPath ?? undefined);
  const guidance = removed.length > 0
    ? formatRegistryResidueGuidance({ registryPath: registryPath ?? '.atm/runtime/write-broker.registry.json', removed })
    : 'No stale broker registry entries were removed.';

  return {
    registry: {
      ...doc,
      currentEpoch: preservedEpoch,
      activeIntents: validIntents
    },
    removed,
    removedCount: removed.length,
    cleanupCommand,
    guidance
  };
}

export function buildBrokerCleanupCommand(registryPath = '.atm/runtime/write-broker.registry.json'): string {
  void registryPath;
  return DEFAULT_BROKER_CLEANUP_COMMAND;
}

export function formatIntentAgeLabel(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function computeIntentAgeMs(intent: ActiveWriteIntent, now = Date.now()): number {
  const heartbeatAtMs = Date.parse(intent.heartbeatAt ?? '');
  if (Number.isFinite(heartbeatAtMs)) {
    return Math.max(0, now - heartbeatAtMs);
  }
  const leaseEpoch = intent.leaseEpoch;
  if (Number.isFinite(leaseEpoch)) {
    return Math.max(0, now - leaseEpoch);
  }
  return 0;
}

export function classifyStaleRegistryEntry(
  intent: ActiveWriteIntent,
  now = Date.now()
): StaleRegistryEntryClassification {
  if (intent.expiresAt) {
    const expiresAtMs = Date.parse(intent.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
      return 'expired-lease';
    }
  }
  return 'stale-heartbeat';
}

export function describeStaleRegistryEntry(
  intent: ActiveWriteIntent,
  options: { readonly now?: number; readonly registryPath?: string | null } = {}
): StaleRegistryEntryEvidence {
  const now = options.now ?? Date.now();
  const classification = classifyStaleRegistryEntry(intent, now);
  const ageMs = computeIntentAgeMs(intent, now);
  const reason = classification === 'expired-lease'
    ? 'lease expired without explicit release'
    : 'heartbeat exceeded stale renewal window without explicit release';

  return {
    intentId: intent.intentId,
    taskId: intent.taskId,
    actorId: intent.actorId,
    owner: intent.actorId,
    registryPath: options.registryPath ?? null,
    expiresAt: intent.expiresAt ?? null,
    heartbeatAt: intent.heartbeatAt ?? null,
    ageMs,
    ageLabel: formatIntentAgeLabel(ageMs),
    classification,
    reason,
    terminalResidue: true
  };
}

export function describeBlockingRegistryIntent(
  intent: ActiveWriteIntent,
  options: { readonly registryPath: string; readonly now?: number }
): StaleRegistryEntryEvidence & { readonly isStale: boolean } {
  const now = options.now ?? Date.now();
  const phase = classifyLeasePhase(intent, now);
  const classification: StaleRegistryEntryClassification = phase === 'stale'
    ? classifyStaleRegistryEntry(intent, now)
    : phase === 'suspect'
      ? 'suspect-heartbeat'
      : 'active-lease';
  const ageMs = computeIntentAgeMs(intent, now);
  const reason = phase === 'stale'
    ? (classification === 'expired-lease'
      ? 'blocking registry entry has an expired lease'
      : 'blocking registry entry exceeded stale heartbeat window')
    : phase === 'suspect'
      ? 'blocking registry entry missed renewal threshold'
      : 'blocking registry entry is still active';

  return {
    intentId: intent.intentId,
    taskId: intent.taskId,
    actorId: intent.actorId,
    owner: intent.actorId,
    registryPath: options.registryPath,
    expiresAt: intent.expiresAt ?? null,
    heartbeatAt: intent.heartbeatAt ?? null,
    ageMs,
    ageLabel: formatIntentAgeLabel(ageMs),
    classification,
    reason,
    terminalResidue: phase === 'stale',
    isStale: phase === 'stale'
  };
}

export function resolveConflictBlockingIntent(
  decision: BrokerDecision,
  registry: WriteBrokerRegistryDocument
): ActiveWriteIntent | null {
  const preservedIntentId = decision.failureReason?.preservedIntentId;
  if (preservedIntentId?.startsWith('active:')) {
    const taskId = preservedIntentId.slice('active:'.length);
    return registry.activeIntents.find((intent) => intent.taskId === taskId) ?? null;
  }

  for (const conflict of decision.conflicts) {
    const taskMatch = /task '([^']+)'/.exec(conflict.detail) ?? /task "([^"]+)"/.exec(conflict.detail);
    if (!taskMatch?.[1]) {
      continue;
    }
    const match = registry.activeIntents.find((intent) => intent.taskId === taskMatch[1]);
    if (match) {
      return match;
    }
  }

  return registry.activeIntents[0] ?? null;
}

export function formatRegistryResidueGuidance(input: {
  readonly registryPath: string;
  readonly removed?: readonly StaleRegistryEntryEvidence[];
  readonly blocking?: StaleRegistryEntryEvidence | null;
}): string {
  const cleanupCommand = buildBrokerCleanupCommand(input.registryPath);
  const lines: string[] = [];

  if (input.blocking) {
    const staleHint = input.blocking.terminalResidue ? 'terminal stale residue' : 'active blocking lease';
    lines.push(
      `Broker registry entry at ${input.registryPath}: task ${input.blocking.taskId} owned by ${input.blocking.owner} (${input.blocking.ageLabel} old, ${staleHint}).`
    );
  }

  for (const entry of input.removed ?? []) {
    lines.push(
      `Removed stale registry entry ${entry.intentId}: task ${entry.taskId} owned by ${entry.owner} (${entry.ageLabel} old, ${entry.classification}).`
    );
  }

  if (lines.length === 0) {
    return 'No stale broker registry residue detected.';
  }

  lines.push(`Run governed cleanup: ${cleanupCommand}`);
  return lines.join(' ');
}

export function buildBlockingRegistryFindingEvidence(input: {
  readonly registryPath: string;
  readonly blockingIntent: ActiveWriteIntent;
  readonly baseReason: string;
  readonly now?: number;
}): BlockingRegistryFindingEvidence {
  const blocking = describeBlockingRegistryIntent(input.blockingIntent, {
    registryPath: input.registryPath,
    now: input.now
  });
  const cleanupCommand = buildBrokerCleanupCommand(input.registryPath);
  const residueSummary = `registry=${input.registryPath}; task=${blocking.taskId}; owner=${blocking.owner}; age=${blocking.ageLabel}; intent=${blocking.intentId}`;
  const staleSuffix = blocking.isStale
    ? ` Classified as terminal stale residue (${blocking.classification}).`
    : '';
  const detail = `${input.baseReason} Blocking entry: ${residueSummary}.${staleSuffix}`;
  const guidance = blocking.isStale
    ? formatRegistryResidueGuidance({ registryPath: input.registryPath, blocking })
    : `${detail} If the lane finished, release with node atm.mjs broker release --task ${blocking.taskId} --json or run ${cleanupCommand}.`;

  return {
    registryPath: input.registryPath,
    blocking,
    detail,
    cleanupCommand,
    guidance,
    isStale: blocking.isStale
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
