import { existsSync, unlinkSync } from 'node:fs';
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
    return {
        registryPath,
        registry: nextRegistry,
        activeIntents: nextRegistry.activeIntents
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
