import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from './types.ts';

export type LeaseLifecyclePhase = 'active' | 'suspect' | 'stale';

export const DEFAULT_ORPHAN_SCAN_INTERVAL_MS = 60_000;
export const DEFAULT_MISSED_RENEWAL_THRESHOLD = 2;
export const DEFAULT_STALE_LEASE_MULTIPLIER = 2;

export interface OrphanCleanupSuspectRecord {
  readonly intentId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly markedAt: string;
  readonly reason: string;
}

export interface OrphanCleanupState {
  readonly schemaId: 'atm.orphanCleanupState.v1';
  readonly specVersion: '0.1.0';
  readonly suspects: Readonly<Record<string, OrphanCleanupSuspectRecord>>;
}

export interface OrphanCleanupCandidate {
  readonly intentId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly phase: LeaseLifecyclePhase;
  readonly reason: string;
}

export interface OrphanCleanupScanResult {
  readonly newlySuspect: readonly OrphanCleanupCandidate[];
  readonly promotedToStale: readonly OrphanCleanupCandidate[];
  readonly released: readonly OrphanCleanupCandidate[];
  readonly active: readonly OrphanCleanupCandidate[];
  readonly nextState: OrphanCleanupState;
  readonly registry: WriteBrokerRegistryDocument;
}

export interface OrphanCleanupScanOptions {
  readonly now?: number;
  readonly missedRenewalThreshold?: number;
  readonly staleLeaseMultiplier?: number;
}

export function emptyOrphanCleanupState(): OrphanCleanupState {
  return {
    schemaId: 'atm.orphanCleanupState.v1',
    specVersion: '0.1.0',
    suspects: {}
  };
}

export function classifyLeasePhase(
  intent: ActiveWriteIntent,
  now: number,
  options: OrphanCleanupScanOptions = {}
): LeaseLifecyclePhase {
  const missedRenewalThreshold = options.missedRenewalThreshold ?? DEFAULT_MISSED_RENEWAL_THRESHOLD;
  const staleLeaseMultiplier = options.staleLeaseMultiplier ?? DEFAULT_STALE_LEASE_MULTIPLIER;

  if (intent.expiresAt) {
    const expiresAtMs = Date.parse(intent.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
      return 'stale';
    }
  }

  const leaseSeconds = Math.max(1, Math.floor(intent.leaseSeconds ?? 300));
  const heartbeatAtMs = Date.parse(intent.heartbeatAt ?? '');
  if (Number.isFinite(heartbeatAtMs)) {
    const ageMs = now - heartbeatAtMs;
    const leaseMs = leaseSeconds * 1000;
    const suspectAfterMs = leaseMs;
    const staleAfterMs = Math.max(leaseMs * missedRenewalThreshold, leaseMs * staleLeaseMultiplier);

    if (ageMs >= staleAfterMs) {
      return 'stale';
    }

    if (ageMs >= suspectAfterMs) {
      return 'suspect';
    }
  }

  return 'active';
}

export function scanOrphanLeases(
  registry: WriteBrokerRegistryDocument,
  state: OrphanCleanupState,
  options: OrphanCleanupScanOptions = {}
): OrphanCleanupScanResult {
  const now = options.now ?? Date.now();
  const nextSuspects: Record<string, OrphanCleanupSuspectRecord> = { ...state.suspects };
  const newlySuspect: OrphanCleanupCandidate[] = [];
  const promotedToStale: OrphanCleanupCandidate[] = [];
  const released: OrphanCleanupCandidate[] = [];
  const active: OrphanCleanupCandidate[] = [];
  const retainedIntents: ActiveWriteIntent[] = [];

  for (const intent of registry.activeIntents) {
    const phase = classifyLeasePhase(intent, now, options);
    const baseCandidate = {
      intentId: intent.intentId,
      taskId: intent.taskId,
      actorId: intent.actorId
    };

    if (phase === 'active') {
      if (nextSuspects[intent.intentId]) {
        delete nextSuspects[intent.intentId];
      }
      active.push({ ...baseCandidate, phase: 'active', reason: 'lease healthy' });
      retainedIntents.push(intent);
      continue;
    }

    if (phase === 'suspect') {
      if (!nextSuspects[intent.intentId]) {
        const reason = 'missed renewal threshold without explicit release';
        nextSuspects[intent.intentId] = {
          intentId: intent.intentId,
          taskId: intent.taskId,
          actorId: intent.actorId,
          markedAt: new Date(now).toISOString(),
          reason
        };
        newlySuspect.push({ ...baseCandidate, phase: 'suspect', reason });
      }
      retainedIntents.push(intent);
      continue;
    }

    const staleReason = nextSuspects[intent.intentId]
      ? 'suspect lease remained unrenewed and was promoted to stale'
      : 'lease expired or exceeded stale heartbeat window';
    if (nextSuspects[intent.intentId]) {
      promotedToStale.push({ ...baseCandidate, phase: 'stale', reason: staleReason });
      delete nextSuspects[intent.intentId];
    } else {
      promotedToStale.push({ ...baseCandidate, phase: 'stale', reason: staleReason });
    }
    released.push({ ...baseCandidate, phase: 'stale', reason: staleReason });
  }

  return {
    newlySuspect,
    promotedToStale,
    released,
    active,
    nextState: {
      schemaId: 'atm.orphanCleanupState.v1',
      specVersion: '0.1.0',
      suspects: nextSuspects
    },
    registry: {
      ...registry,
      activeIntents: retainedIntents
    }
  };
}

export function applyOrphanCleanupScan(
  registry: WriteBrokerRegistryDocument,
  state: OrphanCleanupState,
  options: OrphanCleanupScanOptions = {}
): { readonly result: OrphanCleanupScanResult; readonly state: OrphanCleanupState } {
  const result = scanOrphanLeases(registry, state, options);
  return {
    result,
    state: result.nextState
  };
}
