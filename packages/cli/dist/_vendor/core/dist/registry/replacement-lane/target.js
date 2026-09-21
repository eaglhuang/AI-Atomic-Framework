import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveCanonicalMapPaths } from '../../test-runner/map-integration.js';
import { isAtomicMapRegistryEntry } from '../map-registry.js';
import { createReplacementLaneError, readJson } from './support.js';
export function loadReplacementLaneTarget(repositoryRoot, mapId) {
    const canonicalMapId = String(mapId || '').trim();
    const paths = resolveCanonicalMapPaths(canonicalMapId);
    const specAbsolutePath = path.join(repositoryRoot, paths.specPath);
    const registryAbsolutePath = path.join(repositoryRoot, 'atomic-registry.json');
    if (!existsSync(specAbsolutePath)) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane target map spec was not found.', {
            mapId: canonicalMapId,
            specPath: paths.specPath
        });
    }
    if (!existsSync(registryAbsolutePath)) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires atomic-registry.json.', {
            mapId: canonicalMapId,
            registryPath: 'atomic-registry.json'
        });
    }
    const mapSpec = readJson(specAbsolutePath);
    if (mapSpec?.mapId !== canonicalMapId) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane mapId mismatch in map spec.', {
            expectedMapId: canonicalMapId,
            actualMapId: mapSpec?.mapId ?? null
        });
    }
    if (!mapSpec?.replacement || !Array.isArray(mapSpec.replacement.legacyUris) || mapSpec.replacement.legacyUris.length === 0) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires replacement.legacyUris on the map spec.', {
            mapId: canonicalMapId,
            specPath: paths.specPath
        });
    }
    const registryDocument = readJson(registryAbsolutePath);
    const registryEntry = Array.isArray(registryDocument?.entries)
        ? registryDocument.entries.find((entry) => isAtomicMapRegistryEntry(entry) && entry.mapId === canonicalMapId)
        : null;
    if (!registryEntry) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires a matching map entry in atomic-registry.json.', {
            mapId: canonicalMapId,
            registryPath: 'atomic-registry.json'
        });
    }
    const lineageLogPath = mapSpec.lineageLogRef ?? `${paths.workbenchPath}/lineage-log.json`;
    const lineageLogAbsolutePath = path.join(repositoryRoot, lineageLogPath);
    const lineageLog = existsSync(lineageLogAbsolutePath)
        ? readJson(lineageLogAbsolutePath)
        : null;
    return {
        mapId: canonicalMapId,
        paths: {
            ...paths,
            lineageLogPath
        },
        mapSpec,
        registryDocument,
        registryEntry,
        lineageLog
    };
}
