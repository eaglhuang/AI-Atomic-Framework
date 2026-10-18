import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// Roles that must never be cached
const NON_CACHEABLE_ROLES = new Set(['side-effect', 'rollback-adapter', 'non-deterministic']);
export function computeAtomCacheKey(components) {
    const parts = [
        components.atomId,
        components.atomVersion ?? 'no-version',
        components.atomCid ?? 'no-cid',
        components.inputHash,
        components.policyHash,
        components.toolVersion,
        components.runtimeProfile ?? 'default'
    ].join('|');
    return createHash('sha256').update(parts).digest('base64url');
}
export function computeInputHash(input) {
    return createHash('sha256').update(JSON.stringify(input ?? null)).digest('base64url');
}
function cacheDir(repositoryRoot, mapId) {
    return path.join(repositoryRoot, '.atm-cache', mapId);
}
function cacheFilePath(repositoryRoot, mapId, key) {
    return path.join(cacheDir(repositoryRoot, mapId), `${key}.json`);
}
export function isAtomCacheable(atomRole) {
    if (!atomRole)
        return false;
    return !NON_CACHEABLE_ROLES.has(atomRole);
}
export function getCacheEntry(repositoryRoot, mapId, key) {
    const filePath = cacheFilePath(repositoryRoot, mapId, key);
    if (!existsSync(filePath)) {
        return { hit: false, reason: 'no-cache-entry' };
    }
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw);
        if (entry.key !== key) {
            return { hit: false, reason: 'key-mismatch-bypass' };
        }
        return {
            hit: true,
            output: entry.output,
            key: entry.key,
            keyComponents: entry.keyComponents,
            cachedAt: entry.cachedAt
        };
    }
    catch {
        // Corrupted entry — bypass safely, do not throw
        return { hit: false, reason: 'corrupted-entry-bypass' };
    }
}
export function setCacheEntry(repositoryRoot, mapId, key, components, output) {
    const dir = cacheDir(repositoryRoot, mapId);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const entry = {
        key,
        keyComponents: components,
        cachedAt: new Date().toISOString(),
        output
    };
    writeFileSync(cacheFilePath(repositoryRoot, mapId, key), JSON.stringify(entry, null, 2), 'utf-8');
}
export function invalidateAtomCache(repositoryRoot, mapId, atomId) {
    const dir = cacheDir(repositoryRoot, mapId);
    if (!existsSync(dir))
        return 0;
    let removed = 0;
    try {
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const entry = JSON.parse(readFileSync(path.join(dir, file), 'utf-8'));
                if (entry.keyComponents?.atomId === atomId) {
                    rmSync(path.join(dir, file));
                    removed++;
                }
            }
            catch { /* skip unreadable entries */ }
        }
    }
    catch { /* skip */ }
    return removed;
}
export function clearMapCache(repositoryRoot, mapId) {
    const dir = cacheDir(repositoryRoot, mapId);
    if (!existsSync(dir))
        return { removedFiles: 0 };
    try {
        rmSync(dir, { recursive: true, force: true });
        return { removedFiles: 1 };
    }
    catch {
        return { removedFiles: 0 };
    }
}
