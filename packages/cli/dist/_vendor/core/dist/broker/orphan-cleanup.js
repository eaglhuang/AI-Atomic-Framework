export const DEFAULT_ORPHAN_SCAN_INTERVAL_MS = 60_000;
export const DEFAULT_MISSED_RENEWAL_THRESHOLD = 2;
export const DEFAULT_STALE_LEASE_MULTIPLIER = 2;
export function emptyOrphanCleanupState() {
    return {
        schemaId: 'atm.orphanCleanupState.v1',
        specVersion: '0.1.0',
        suspects: {}
    };
}
export function classifyLeasePhase(intent, now, options = {}) {
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
export function scanOrphanLeases(registry, state, options = {}) {
    const now = options.now ?? Date.now();
    const nextSuspects = { ...state.suspects };
    const newlySuspect = [];
    const promotedToStale = [];
    const released = [];
    const active = [];
    const retainedIntents = [];
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
        }
        else {
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
export function applyOrphanCleanupScan(registry, state, options = {}) {
    const result = scanOrphanLeases(registry, state, options);
    return {
        result,
        state: result.nextState
    };
}
