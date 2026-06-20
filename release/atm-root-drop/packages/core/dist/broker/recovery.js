import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyOrphanCleanupScan, emptyOrphanCleanupState } from './orphan-cleanup.js';
export const DEFAULT_BROKER_SNAPSHOT_RELATIVE_DIR = '.atm/runtime/broker-snapshot';
export function createManualOverrideAuditEntry(input) {
    const severity = input.activeLeaseCollision
        ? 'critical'
        : input.overrideKind === 'lease-bypass'
            ? 'high'
            : 'medium';
    return {
        auditId: `override-${Date.now()}`,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        actorId: input.actorId,
        taskId: input.taskId,
        overrideKind: input.overrideKind,
        reason: input.reason,
        previousLeaseEpoch: input.previousLeaseEpoch,
        severity,
        activeLeaseCollision: input.activeLeaseCollision
    };
}
export function appendManualOverrideAudit(auditTrail, entry) {
    return [...auditTrail, entry].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}
export function buildBrokerRecoverySnapshot(input) {
    return {
        schemaId: 'atm.brokerRecoverySnapshot.v1',
        specVersion: '0.1.0',
        flushedAt: input.flushedAt ?? new Date().toISOString(),
        registry: input.registry,
        orphanCleanupState: input.orphanCleanupState ?? emptyOrphanCleanupState(),
        manualOverrideAudit: input.manualOverrideAudit ?? []
    };
}
export function flushBrokerRecoverySnapshot(input) {
    const snapshotDir = resolveBrokerSnapshotDir(input.cwd, input.snapshotDir);
    mkdirSync(snapshotDir, { recursive: true });
    const snapshot = buildBrokerRecoverySnapshot({
        registry: input.registry,
        orphanCleanupState: input.orphanCleanupState,
        manualOverrideAudit: input.manualOverrideAudit
    });
    const snapshotPath = path.join(snapshotDir, `broker-recovery-${snapshot.flushedAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(snapshotDir, 'latest.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return { snapshotPath, snapshot };
}
export function loadLatestBrokerRecoverySnapshot(cwd, snapshotDir) {
    const resolvedDir = resolveBrokerSnapshotDir(cwd, snapshotDir);
    const latestPath = path.join(resolvedDir, 'latest.json');
    if (existsSync(latestPath)) {
        return JSON.parse(readFileSync(latestPath, 'utf8'));
    }
    if (!existsSync(resolvedDir)) {
        return null;
    }
    const candidates = readdirSync(resolvedDir)
        .filter((name) => name.startsWith('broker-recovery-') && name.endsWith('.json'))
        .sort();
    const newest = candidates.at(-1);
    if (!newest) {
        return null;
    }
    return JSON.parse(readFileSync(path.join(resolvedDir, newest), 'utf8'));
}
export function recoverRegistryFromSnapshot(snapshot, options = {}) {
    const now = options.now ?? Date.now();
    const suspectIntents = [];
    const rejectedIntents = [];
    const retainedIntents = [];
    for (const intent of snapshot.registry.activeIntents) {
        const expiresAtMs = intent.expiresAt ? Date.parse(intent.expiresAt) : Number.NaN;
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
            rejectedIntents.push({
                intent,
                recoveryStatus: 'rejected-stale',
                reason: 'expired lease cannot be treated as valid without explicit renewal'
            });
            continue;
        }
        suspectIntents.push({
            intent,
            recoveryStatus: 'requires-renewal',
            reason: 'snapshot lease requires explicit renew before admission'
        });
        retainedIntents.push(intent);
    }
    const recoveredRegistry = {
        ...snapshot.registry,
        activeIntents: retainedIntents
    };
    return {
        snapshotPath: null,
        recoveredRegistry,
        suspectIntents,
        rejectedIntents,
        auditTrail: [...snapshot.manualOverrideAudit],
        orphanCleanupState: snapshot.orphanCleanupState ?? emptyOrphanCleanupState()
    };
}
export function revalidateRecoveredLease(input) {
    const now = input.now ?? Date.now();
    const expiresAtMs = input.intent.expiresAt ? Date.parse(input.intent.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
        return {
            ok: false,
            intent: null,
            reason: 'cannot revalidate an expired lease'
        };
    }
    if (input.actorId !== input.intent.actorId) {
        return {
            ok: false,
            intent: null,
            reason: 'lease renewal must be performed by the owning actor'
        };
    }
    if (input.renewalEpoch <= input.intent.leaseEpoch) {
        return {
            ok: false,
            intent: null,
            reason: 'renewal epoch must be newer than the recovered lease epoch'
        };
    }
    const leaseSeconds = Math.max(1, Math.floor(input.intent.leaseSeconds ?? 300));
    const heartbeatAt = new Date(now).toISOString();
    const expiresAt = new Date(now + leaseSeconds * 1000).toISOString();
    return {
        ok: true,
        intent: {
            ...input.intent,
            leaseEpoch: input.renewalEpoch,
            heartbeatAt,
            expiresAt
        },
        reason: 'lease revalidated'
    };
}
export function recoverBrokerRuntime(input) {
    const snapshot = loadLatestBrokerRecoverySnapshot(input.cwd, input.snapshotDir);
    if (!snapshot) {
        return {
            snapshotPath: null,
            recoveredRegistry: {
                schemaId: 'atm.writeBrokerRegistry.v1',
                specVersion: '0.1.0',
                repoId: 'local-repo',
                workspaceId: 'main',
                currentEpoch: Date.now(),
                activeIntents: []
            },
            suspectIntents: [],
            rejectedIntents: [],
            auditTrail: [],
            orphanCleanupState: emptyOrphanCleanupState()
        };
    }
    const loaded = recoverRegistryFromSnapshot(snapshot, { now: input.now });
    const intentById = new Map(loaded.recoveredRegistry.activeIntents.map((intent) => [intent.intentId, intent]));
    const cleanup = applyOrphanCleanupScan(loaded.recoveredRegistry, loaded.orphanCleanupState, { now: input.now });
    const orphanRejections = [];
    for (const entry of cleanup.result.released) {
        const intent = intentById.get(entry.intentId);
        if (!intent)
            continue;
        orphanRejections.push({
            intent,
            recoveryStatus: 'rejected-stale',
            reason: entry.reason
        });
    }
    return {
        ...loaded,
        recoveredRegistry: cleanup.result.registry,
        rejectedIntents: [...loaded.rejectedIntents, ...orphanRejections],
        orphanCleanupState: cleanup.state
    };
}
function resolveBrokerSnapshotDir(cwd, snapshotDir) {
    return path.resolve(cwd, snapshotDir ?? DEFAULT_BROKER_SNAPSHOT_RELATIVE_DIR);
}
