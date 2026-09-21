import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const GLOBAL_MAP_REGISTRY_PATH = path.join(os.homedir(), '.atm', 'map-registry.json');
const REPO_MAP_REGISTRY_FILENAME = path.join('vendor', 'maps', 'map-registry.json');
export function loadMapRegistry(registryPath) {
    if (!existsSync(registryPath))
        return createEmptyMapRegistry();
    try {
        return JSON.parse(readFileSync(registryPath, 'utf-8'));
    }
    catch {
        return createEmptyMapRegistry();
    }
}
export function saveMapRegistry(registry, registryPath) {
    mkdirSync(path.dirname(registryPath), { recursive: true });
    registry.updatedAt = new Date().toISOString();
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}
export function getGlobalMapRegistryPath() {
    return GLOBAL_MAP_REGISTRY_PATH;
}
export function getRepoMapRegistryPath(repositoryRoot) {
    return path.join(repositoryRoot, REPO_MAP_REGISTRY_FILENAME);
}
export function upsertMapEntry(registry, mapCid, entry) {
    const existing = registry.entries[mapCid];
    registry.entries[mapCid] = {
        mapId: entry.mapId,
        humanName: entry.humanName,
        memberAtomCids: entry.memberAtomCids,
        exportedAt: entry.exportedAt ?? existing?.exportedAt ?? new Date().toISOString(),
        exportedBy: entry.exportedBy ?? existing?.exportedBy,
        previousMapCid: entry.previousMapCid !== undefined ? entry.previousMapCid : (existing?.previousMapCid ?? null),
        nextMapCid: entry.nextMapCid !== undefined ? entry.nextMapCid : (existing?.nextMapCid ?? null),
        status: entry.status ?? existing?.status ?? 'active',
        storageLocations: entry.storageLocations ?? existing?.storageLocations ?? [],
        advisories: entry.advisories ?? existing?.advisories ?? []
    };
    // Update currentPointers to latest active entry
    if (registry.entries[mapCid].status === 'active') {
        registry.currentPointers[entry.mapId] = mapCid;
    }
}
export function linkMapChain(registry, previousMapCid, nextMapCid) {
    const prev = registry.entries[previousMapCid];
    if (prev) {
        prev.nextMapCid = nextMapCid;
        prev.status = 'superseded';
    }
    const next = registry.entries[nextMapCid];
    if (next) {
        next.previousMapCid = previousMapCid;
    }
}
export function markMapRolledBack(registry, mapCid) {
    const entry = registry.entries[mapCid];
    if (entry)
        entry.status = 'rolled-back';
}
export function getMapEntry(registry, mapCid) {
    return registry.entries[mapCid];
}
export function getCurrentMapCid(registry, mapId) {
    return registry.currentPointers[mapId];
}
function createEmptyMapRegistry() {
    return {
        schemaVersion: 'atm.map-registry.v0.1',
        updatedAt: new Date().toISOString(),
        currentPointers: {},
        entries: {}
    };
}
