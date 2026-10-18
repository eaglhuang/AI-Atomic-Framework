import path from 'node:path';
import { existsSync, readJson } from './files.js';
import { asRecord, atomIdLikePattern, atomIdPattern } from './types.js';
export function buildCatalog(repoPath, registry) {
    const entries = [];
    const registryAtomIds = new Set();
    const registryRecord = asRecord(registry);
    const registryEntries = Array.isArray(registryRecord?.entries)
        ? registryRecord.entries
        : [];
    for (const rawEntry of registryEntries) {
        const entry = asRecord(rawEntry);
        const atomId = typeof entry?.atomId === 'string' ? entry.atomId : null;
        if (atomId) {
            registryAtomIds.add(atomId);
            entries.push(atomCatalogEntry(repoPath, atomId, entry, entries));
            continue;
        }
        const mapId = typeof entry?.mapId === 'string' ? entry.mapId : null;
        if (mapId) {
            const mapSpec = readMapSpec(repoPath, mapId, entry?.location?.specPath);
            entries.push(mapCatalogEntry(repoPath, mapId, entry, mapSpec, entries));
        }
    }
    for (const entry of [...entries]) {
        if (entry.kind === 'map') {
            addMapMemberAtoms(repoPath, entry, registryAtomIds, entries);
        }
    }
    return entries.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}
function atomCatalogEntry(repoPath, atomId, entry, existing) {
    return {
        kind: 'atom',
        id: atomId,
        refName: ensureUniqueRefName(curatedRefName(repoPath, atomId, 'atom') ?? deriveRefName(String(entry?.logicalName ?? entry?.purpose ?? atomId), 'atom'), existing),
        logicalName: normalizeLogicalName(entry?.logicalName, atomId, 'atom'),
        purpose: normalizePurpose(entry?.purpose, atomId, entry?.location?.codePaths, 'atom'),
        sourcePaths: normalizeSourcePaths(entry?.location?.codePaths ?? entry?.selfVerification?.sourcePaths?.code ?? []),
        members: [],
        entrypoints: []
    };
}
function addMapMemberAtoms(repoPath, entry, registryAtomIds, entries) {
    for (const member of entry.members) {
        if (registryAtomIds.has(member) || entries.some((candidate) => candidate.kind === 'atom' && candidate.id === member)) {
            continue;
        }
        entries.push({
            kind: 'atom',
            id: member,
            refName: ensureUniqueRefName(curatedRefName(repoPath, member, 'atom') ?? deriveRefName(`${entry.logicalName} ${memberRoleName(entry, member)}`, 'atom'), entries),
            logicalName: `${entry.logicalName}.${member.toLowerCase()}`,
            purpose: `Member atom for ${entry.logicalName}: ${memberRoleName(entry, member)}.`,
            sourcePaths: entry.sourcePaths,
            members: [],
            entrypoints: []
        });
    }
}
function mapCatalogEntry(repoPath, mapId, entry, mapSpec, existing) {
    const logicalName = normalizeLogicalName(selectMapSemanticHint(entry, mapSpec), mapId, 'map');
    const sourcePaths = normalizeSourcePaths([
        entry?.location?.specPath,
        `atomic_workbench/maps/${mapId}/map.spec.json`,
        entry?.location?.reportPath,
        `atomic_workbench/maps/${mapId}/map.test.report.json`
    ]);
    return {
        kind: 'map',
        id: mapId,
        refName: ensureUniqueRefName(curatedRefName(repoPath, mapId, 'map') ?? deriveRefName(logicalName, 'map'), existing),
        logicalName,
        purpose: normalizePurpose(entry?.purpose ?? mapSpec.description ?? mapSpec.qualityTargets?.pilotName, mapId, sourcePaths, 'map'),
        sourcePaths,
        members: normalizeStringArray(Array.isArray(mapSpec.members)
            ? mapSpec.members.map((member) => asRecord(member)?.atomId)
            : []),
        entrypoints: normalizeStringArray(mapSpec.entrypoints)
    };
}
function readMapSpec(repoPath, mapId, configuredPath) {
    const candidates = [
        typeof configuredPath === 'string' ? configuredPath : '',
        `atomic_workbench/maps/${mapId}/map.spec.json`
    ].filter(Boolean);
    for (const candidate of candidates) {
        const absolutePath = path.resolve(repoPath, candidate);
        if (existsSync(absolutePath)) {
            return asRecord(readJson(absolutePath)) ?? {};
        }
    }
    return {};
}
function curatedRefName(repoPath, id, kind) {
    const override = readableRefOverrides(repoPath)[id];
    if (typeof override === 'string' && override.trim().length > 0) {
        return override.trim();
    }
    const repoName = path.basename(repoPath).toLowerCase();
    const framework = {
        'ATM-CORE-0001': 'coreSeedAtom',
        'ATM-CORE-0003': 'protectedSurfaceNeutralityScannerAtom',
        'ATM-CORE-0004': 'atomProvisioningFacadeAtom',
        'ATM-CORE-0005': 'atomicSpecSemanticFingerprintAtom',
        'ATM-FIXTURE-0001': 'compliantGeneratedFixtureAtom',
        'ATM-MAP-0001': 'atomProvisioningFixtureMap',
        'ATM-MAP-0002': 'protectedSurfaceNeutralityMap'
    };
    if (repoName === 'ai-atomic-framework') {
        return framework[id] ?? null;
    }
    return kind === 'atom' ? null : null;
}
function readableRefOverrides(repoPath) {
    const overridePath = path.join(repoPath, 'atomic_workbench', 'readable-ref-overrides.json');
    if (!existsSync(overridePath)) {
        return {};
    }
    try {
        const parsed = readJson(overridePath);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function selectMapSemanticHint(entry, mapSpec) {
    const entryRecord = asRecord(entry);
    const mapSpecRecord = asRecord(mapSpec);
    return entryRecord?.logicalName
        ?? mapSpecRecord?.logicalName
        ?? mapSpecRecord?.qualityTargets?.pilotName
        ?? mapSpecRecord?.qualityTargets?.equivalenceFixtures
        ?? (Array.isArray(mapSpecRecord?.replacement?.legacyUris) ? mapSpecRecord.replacement.legacyUris[0] : undefined);
}
function deriveRefName(value, kind) {
    const tokens = (value.match(/[A-Za-z0-9]+/g) ?? [])
        .filter((token) => !/^ATM$/i.test(token) && !/^\d+$/.test(token))
        .slice(0, 6);
    const fallback = kind === 'atom' ? ['readable', 'atom'] : ['readable', 'map'];
    const usable = tokens.length > 0 ? tokens : fallback;
    const [first, ...rest] = usable.map((token) => token.toLowerCase());
    const base = [first, ...rest.map((token) => token.charAt(0).toUpperCase() + token.slice(1))].join('');
    const suffix = kind === 'atom' ? 'Atom' : 'Map';
    return base.endsWith(suffix) ? base : `${base}${suffix}`;
}
function ensureUniqueRefName(name, existing) {
    const used = new Set(existing.map((entry) => entry.refName));
    if (!used.has(name)) {
        return name;
    }
    let counter = 2;
    while (used.has(`${name}${counter}`)) {
        counter += 1;
    }
    return `${name}${counter}`;
}
function normalizeLogicalName(value, id, kind) {
    if (typeof value === 'string' && value.trim().length > 0 && !atomIdPattern.test(value.trim())) {
        return value.trim();
    }
    return `${kind}.${id.toLowerCase()}`;
}
function normalizePurpose(value, id, sourcePaths, kind) {
    if (typeof value === 'string' && value.trim().length > 0 && !atomIdLikePattern.test(value.trim())) {
        return value.trim();
    }
    const paths = normalizeSourcePaths(sourcePaths);
    if (paths.length > 0) {
        return `Readable ${kind} ref for ${paths[0]}.`;
    }
    return `Readable ${kind} ref for ${id}.`;
}
function memberRoleName(mapEntry, atomId) {
    const index = mapEntry.members.indexOf(atomId);
    if (index === 0) {
        return 'entrypoint';
    }
    if (index === mapEntry.members.length - 1) {
        return 'final step';
    }
    return `step ${index + 1}`;
}
export function normalizeSourcePaths(value) {
    if (typeof value === 'string') {
        return value ? [value] : [];
    }
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.flatMap((entry) => normalizeSourcePaths(entry)))].filter(Boolean).sort();
}
export function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0))];
}
