import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, releaseTask, cleanupStale, saveRegistry, renewIntentLease } from './registry.js';
import { DEFAULT_BROKER_REGISTRY_RELATIVE_PATH } from './team-lane.js';
export const DEFAULT_BROKER_LIFECYCLE_REGISTRY_RELATIVE_PATH = DEFAULT_BROKER_REGISTRY_RELATIVE_PATH;
export function readBrokerLifecycleState(cwd) {
    const registryPath = resolveBrokerRegistryPath(cwd);
    const registry = cleanupStale(loadRegistry(registryPath));
    return {
        registryPath,
        registry,
        activeIntents: registry.activeIntents
    };
}
export function inspectBrokerClaimLifecycle(input) {
    const state = readBrokerLifecycleState(input.cwd);
    const blockingIntent = state.activeIntents.find((intent) => intent.taskId === input.taskId && intent.actorId !== input.actorId) ?? null;
    if (blockingIntent) {
        return {
            ok: false,
            blocked: true,
            reason: `Task ${input.taskId} already has an active broker intent owned by ${blockingIntent.actorId}.`,
            registryPath: state.registryPath,
            blockingIntent,
            activeIntents: state.activeIntents
        };
    }
    return {
        ok: true,
        blocked: false,
        reason: null,
        registryPath: state.registryPath,
        blockingIntent: null,
        activeIntents: state.activeIntents
    };
}
export function recordBrokerClaimIntent(input) {
    const registryPath = resolveBrokerRegistryPath(input.cwd);
    const registry = cleanupStale(loadRegistry(registryPath));
    const now = new Date().toISOString();
    const nextRegistry = {
        ...registry,
        currentEpoch: Date.now(),
        activeIntents: [
            ...registry.activeIntents.filter((intent) => intent.taskId !== input.taskId),
            {
                intentId: `intent-${Date.now()}`,
                taskId: input.taskId,
                teamRunId: null,
                actorId: input.actorId,
                baseCommit: 'unknown-base-commit',
                resourceKeys: {
                    files: uniqueStrings(input.targetFiles ?? []),
                    atomIds: [],
                    atomCids: [],
                    generators: [],
                    projections: [],
                    registries: [],
                    validators: [],
                    artifacts: []
                },
                leaseEpoch: Date.now(),
                leaseSeconds: Math.max(1, Math.floor(input.ttlSeconds ?? 1800)),
                leaseMaxSeconds: Math.max(1, Math.floor(input.leaseMaxSeconds ?? input.ttlSeconds ?? 1800)),
                heartbeatAt: now,
                lane: input.lane ?? 'direct-brokered',
                expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 1800) * 1000).toISOString()
            }
        ]
    };
    saveRegistry(registryPath, nextRegistry);
    return {
        registryPath,
        registry: nextRegistry,
        activeIntents: nextRegistry.activeIntents
    };
}
export function clearBrokerRuntimeStateForTask(input) {
    const registryPath = resolveBrokerRegistryPath(input.cwd);
    const registry = cleanupStale(loadRegistry(registryPath));
    const nextRegistry = releaseTask(registry, input.taskId);
    saveRegistry(registryPath, nextRegistry);
    const runtimeCleanup = cleanupBrokerRuntimeSnapshots({
        cwd: input.cwd,
        releasedTaskIds: [input.taskId],
        activeTaskIds: nextRegistry.activeIntents.map((intent) => intent.taskId)
    });
    return {
        registryPath,
        registry: nextRegistry,
        activeIntents: nextRegistry.activeIntents,
        runtimeCleanup
    };
}
export function cleanupBrokerRuntimeSnapshots(input) {
    const runtimeRoot = path.join(path.resolve(input.cwd), '.atm', 'runtime');
    const releasedTaskIds = new Set((input.releasedTaskIds ?? []).map((taskId) => taskId.trim()).filter(Boolean));
    const activeTaskIds = new Set((input.activeTaskIds ?? readBrokerLifecycleState(input.cwd).activeIntents.map((intent) => intent.taskId)).map((taskId) => taskId.trim()).filter(Boolean));
    const removedIntentSnapshots = pruneIntentSnapshots({
        runtimeRoot,
        releasedTaskIds,
        activeTaskIds
    });
    const queueCleanup = pruneSharedQueueSnapshot({
        filePath: path.join(runtimeRoot, 'broker-shared-surface-queues.json'),
        releasedTaskIds,
        activeTaskIds
    });
    const freezeCleanup = pruneSharedFreezeSnapshot({
        filePath: path.join(runtimeRoot, 'broker-shared-surface-freezes.json'),
        releasedTaskIds,
        activeTaskIds
    });
    return {
        removedIntentSnapshots,
        removedSharedQueueSnapshot: queueCleanup.removedSnapshot,
        removedSharedFreezeSnapshot: freezeCleanup.removedSnapshot,
        prunedSharedQueueEntries: queueCleanup.prunedEntries,
        prunedSharedFreezeRecords: freezeCleanup.prunedEntries
    };
}
export function renewBrokerClaimIntent(input) {
    const registryPath = resolveBrokerRegistryPath(input.cwd);
    const registry = cleanupStale(loadRegistry(registryPath));
    const nextRegistry = renewIntentLease(registry, input.taskId, input.actorId, input.ttlSeconds ?? 1800);
    saveRegistry(registryPath, nextRegistry);
    return {
        registryPath,
        registry: nextRegistry,
        activeIntents: nextRegistry.activeIntents
    };
}
export function removeBrokerRegistryIfEmpty(cwd) {
    const registryPath = resolveBrokerRegistryPath(cwd);
    if (!existsSync(registryPath))
        return false;
    const registry = cleanupStale(loadRegistry(registryPath));
    if ((registry.activeIntents ?? []).length > 0) {
        saveRegistry(registryPath, registry);
        return false;
    }
    unlinkSync(registryPath);
    return true;
}
export function describeBrokerLifecyclePaths(cwd) {
    return {
        registryPath: path.join(path.resolve(cwd), DEFAULT_BROKER_LIFECYCLE_REGISTRY_RELATIVE_PATH)
    };
}
function resolveBrokerRegistryPath(cwd) {
    return path.join(path.resolve(cwd), DEFAULT_BROKER_LIFECYCLE_REGISTRY_RELATIVE_PATH);
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
function pruneIntentSnapshots(input) {
    const intentDir = path.join(input.runtimeRoot, 'broker-intents');
    if (!existsSync(intentDir))
        return [];
    const removed = [];
    for (const fileName of readdirSync(intentDir)) {
        if (!fileName.endsWith('.json'))
            continue;
        const filePath = path.join(intentDir, fileName);
        const snapshotTaskId = readSnapshotTaskId(filePath) ?? fileName.slice(0, -'.json'.length);
        const shouldRemove = input.releasedTaskIds.has(snapshotTaskId) || !input.activeTaskIds.has(snapshotTaskId);
        if (!shouldRemove)
            continue;
        unlinkSync(filePath);
        removed.push(path.relative(input.runtimeRoot, filePath).replace(/\\/g, '/'));
    }
    if (readdirSync(intentDir).length === 0) {
        rmSync(intentDir, { recursive: true, force: true });
    }
    return removed;
}
function pruneSharedQueueSnapshot(input) {
    const doc = readJsonObject(input.filePath);
    if (!doc)
        return { removedSnapshot: false, prunedEntries: 0 };
    const queues = Array.isArray(doc.queues) ? doc.queues : [];
    const nextQueues = queues.flatMap((queue) => {
        const entries = Array.isArray(queue?.entries) ? queue.entries.filter((entry) => {
            const taskId = String(entry?.taskId ?? '').trim();
            return taskId && !input.releasedTaskIds.has(taskId) && input.activeTaskIds.has(taskId);
        }) : [];
        return entries.length > 0 ? [{ ...queue, entries }] : [];
    });
    const previousEntryCount = queues.reduce((count, queue) => count + (Array.isArray(queue?.entries) ? queue.entries.length : 0), 0);
    if (nextQueues.length === 0) {
        unlinkSync(input.filePath);
        return { removedSnapshot: true, prunedEntries: previousEntryCount };
    }
    writeJson(input.filePath, { ...doc, queues: nextQueues });
    const nextEntryCount = nextQueues.reduce((count, queue) => count + (Array.isArray(queue?.entries) ? queue.entries.length : 0), 0);
    return { removedSnapshot: false, prunedEntries: previousEntryCount - nextEntryCount };
}
function pruneSharedFreezeSnapshot(input) {
    const doc = readJsonObject(input.filePath);
    if (!doc)
        return { removedSnapshot: false, prunedEntries: 0 };
    const records = Array.isArray(doc.records) ? doc.records : [];
    const nextRecords = records.filter((record) => {
        const taskId = String(record?.signal?.taskId ?? '').trim();
        const status = String(record?.status ?? '').trim();
        return taskId && status !== 'released' && !input.releasedTaskIds.has(taskId) && input.activeTaskIds.has(taskId);
    });
    if (nextRecords.length === 0) {
        unlinkSync(input.filePath);
        return { removedSnapshot: true, prunedEntries: records.length };
    }
    writeJson(input.filePath, { ...doc, records: nextRecords });
    return { removedSnapshot: false, prunedEntries: records.length - nextRecords.length };
}
function readSnapshotTaskId(filePath) {
    const doc = readJsonObject(filePath);
    const taskId = String(doc?.taskId ?? '').trim();
    return taskId || null;
}
function readJsonObject(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
