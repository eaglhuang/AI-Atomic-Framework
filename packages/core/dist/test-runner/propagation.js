import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runMapIntegrationTest } from './map-integration.js';
import { createTestReportMetrics } from './metrics-collector.js';
export const propagationTriggerBehaviors = Object.freeze(['split', 'merge', 'atomize', 'infect', 'evolve']);
export const defaultPropagationReportMigration = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'Initial propagation report contract.'
});
export function shouldPropagateBehavior(behavior) {
    if (typeof behavior !== 'string') {
        return false;
    }
    return propagationTriggerBehaviors.includes(behavior.trim().toLowerCase());
}
export function discoverMapsForAtom(atomId, options) {
    const normalizedOptions = options || {};
    const repositoryRoot = path.resolve(normalizedOptions.repositoryRoot ?? process.cwd());
    const discovered = new Set();
    for (const mapId of discoverMapsFromRegistry(atomId, { repositoryRoot, registryDocument: normalizedOptions.registryDocument, registryPath: normalizedOptions.registryPath })) {
        discovered.add(mapId);
    }
    for (const mapId of discoverMapsFromFilesystem(atomId, { repositoryRoot })) {
        discovered.add(mapId);
    }
    return [...discovered].sort((left, right) => left.localeCompare(right));
}
export function runPropagationIntegration(atomId, options) {
    const normalizedOptions = options || {};
    const repositoryRoot = path.resolve(normalizedOptions.repositoryRoot ?? process.cwd());
    const requestedBehavior = normalizedOptions.behavior ?? null;
    const behaviorTriggersPropagation = requestedBehavior == null ? true : shouldPropagateBehavior(requestedBehavior);
    const maps = discoverMapsForAtom(atomId, { repositoryRoot, registryDocument: normalizedOptions.registryDocument, registryPath: normalizedOptions.registryPath });
    if (!behaviorTriggersPropagation) {
        return {
            ok: true,
            atomId,
            behavior: requestedBehavior,
            skipped: true,
            discoveredMaps: maps,
            perMapStatus: [],
            failedDownstream: [],
            propagationDuration: 0,
            metrics: createTestReportMetrics({ latency: 0, total: 0, failed: 0 }),
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                durationMs: 0
            }
        };
    }
    const startedAt = Date.now();
    const results = maps.map((mapId) => runMapIntegrationTest(mapId, {
        repositoryRoot,
        now: normalizedOptions.now,
        writeReport: normalizedOptions.writeReport
    }));
    const propagationDuration = Date.now() - startedAt;
    const perMapStatus = results.map((result) => result.mapStatus);
    const failedDownstream = perMapStatus.filter((entry) => entry.ok !== true).map((entry) => entry.mapId);
    const total = perMapStatus.length;
    const failed = failedDownstream.length;
    const passed = total - failed;
    return {
        ok: failed === 0,
        atomId,
        behavior: requestedBehavior,
        skipped: false,
        discoveredMaps: maps,
        perMapStatus,
        failedDownstream,
        propagationDuration,
        metrics: createTestReportMetrics({ latency: propagationDuration, total, failed }),
        summary: {
            total,
            passed,
            failed,
            durationMs: propagationDuration
        }
    };
}
export function createPropagationReport(propagation, options = {}) {
    const atomId = String(options.atomId ?? propagation?.atomId ?? '').trim();
    const reportIdBase = atomId.toLowerCase();
    const behaviorId = normalizeBehaviorId(options.behaviorId ?? propagation?.behavior ?? null);
    return {
        schemaId: 'atm.propagationReport',
        specVersion: '0.1.0',
        migration: defaultPropagationReportMigration,
        reportId: options.reportId ?? `propagation.${reportIdBase}${behaviorId ? `.${behaviorId.replace(/^behavior\./, '').replace(/[^a-z0-9.-]/g, '-')}` : ''}`,
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        atomId,
        ...(behaviorId ? { behaviorId } : {}),
        discoveredMaps: normalizeStringSet(propagation?.discoveredMaps),
        perMapStatus: normalizePerMapStatus(propagation?.perMapStatus),
        failedDownstream: normalizeStringSet(propagation?.failedDownstream),
        propagationDuration: Number.isInteger(propagation?.propagationDuration) ? propagation.propagationDuration : 0,
        metrics: propagation?.metrics ?? createTestReportMetrics({ latency: 0, total: 0, failed: 0 }),
        summary: {
            total: Number(propagation?.summary?.total ?? 0),
            passed: Number(propagation?.summary?.passed ?? 0),
            failed: Number(propagation?.summary?.failed ?? 0),
            durationMs: Number(propagation?.summary?.durationMs ?? propagation?.propagationDuration ?? 0)
        },
        passed: propagation?.ok === true
    };
}
export function validatePropagationReport(report, options = {}) {
    const issues = [];
    if (report?.schemaId !== 'atm.propagationReport') {
        issues.push('propagation report schemaId must be atm.propagationReport.');
    }
    if (report?.passed !== true) {
        issues.push('propagation report must pass.');
    }
    if (Array.isArray(report?.failedDownstream) && report.failedDownstream.length > 0) {
        issues.push('propagation report still has failing downstream maps.');
    }
    if (typeof options.atomId === 'string' && options.atomId.length > 0 && report?.atomId !== options.atomId) {
        issues.push(`propagation report atomId ${String(report?.atomId ?? 'unknown')} does not match ${options.atomId}.`);
    }
    if (typeof options.mapId === 'string' && options.mapId.length > 0) {
        const discoveredMaps = normalizeStringSet(report?.discoveredMaps);
        if (!discoveredMaps.includes(options.mapId)) {
            issues.push(`propagation report does not cover target map ${options.mapId}.`);
        }
    }
    return {
        ok: issues.length === 0,
        issues
    };
}
function discoverMapsFromRegistry(atomId, options) {
    const normalizedOptions = options || {};
    const registryDocument = normalizedOptions.registryDocument ?? readRegistryDocument(path.resolve(normalizedOptions.repositoryRoot ?? process.cwd(), normalizedOptions.registryPath ?? 'atomic-registry.json'));
    const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
    return entries
        .filter((entry) => entry?.schemaId === 'atm.atomicMap')
        .filter((entry) => Array.isArray(entry?.members) && entry.members.some((member) => String(member?.atomId || '').trim() === atomId))
        .map((entry) => String(entry.mapId || '').trim())
        .filter(Boolean);
}
function discoverMapsFromFilesystem(atomId, options) {
    const normalizedOptions = options || {};
    const repositoryRoot = path.resolve(normalizedOptions.repositoryRoot ?? process.cwd());
    const discovered = [];
    const canonicalMapsRoot = path.join(repositoryRoot, 'atomic_workbench', 'maps');
    if (existsSync(canonicalMapsRoot)) {
        const canonicalDirectories = readdirSync(canonicalMapsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
        for (const canonicalDirectory of canonicalDirectories) {
            const specPath = path.join(canonicalMapsRoot, canonicalDirectory.name, 'map.spec.json');
            const mapId = tryReadMapIdForAtom(specPath, atomId);
            if (mapId) {
                discovered.push(mapId);
            }
        }
    }
    const legacyAtomsRoot = path.join(repositoryRoot, 'atomic_workbench', 'atoms');
    if (existsSync(legacyAtomsRoot)) {
        const ownerDirectories = readdirSync(legacyAtomsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
        for (const ownerDirectory of ownerDirectories) {
            const specPath = path.join(legacyAtomsRoot, ownerDirectory.name, 'map', 'map.spec.json');
            const mapId = tryReadMapIdForAtom(specPath, atomId);
            if (mapId) {
                discovered.push(mapId);
            }
        }
    }
    return [...new Set(discovered)];
}
function tryReadMapIdForAtom(specPath, atomId) {
    if (!existsSync(specPath)) {
        return null;
    }
    try {
        const specDocument = JSON.parse(readFileSync(specPath, 'utf8'));
        const hasAtom = Array.isArray(specDocument?.members)
            && specDocument.members.some((member) => String(member?.atomId || '').trim() === atomId);
        if (!hasAtom) {
            return null;
        }
        return String(specDocument?.mapId || '').trim() || null;
    }
    catch {
        return null;
    }
}
function readRegistryDocument(registryPath) {
    if (!existsSync(registryPath)) {
        return { entries: [] };
    }
    return JSON.parse(readFileSync(registryPath, 'utf8'));
}
function normalizePerMapStatus(values) {
    return (Array.isArray(values) ? values : []).map((entry) => ({
        mapId: String(entry?.mapId ?? '').trim(),
        ok: entry?.ok === true,
        exitCode: Number.isInteger(entry?.exitCode) ? entry.exitCode : 1,
        durationMs: Number.isInteger(entry?.durationMs) ? entry.durationMs : 0,
        resolutionMode: entry?.resolutionMode === 'legacy' ? 'legacy' : 'canonical',
        reportPath: String(entry?.reportPath ?? '').trim(),
        ...(typeof entry?.stdout === 'string' ? { stdout: entry.stdout } : {}),
        ...(typeof entry?.stderr === 'string' ? { stderr: entry.stderr } : {}),
        warnings: normalizeStringSet(entry?.warnings)
    }));
}
function normalizeStringSet(values) {
    return [...new Set((Array.isArray(values) ? values : [])
            .map((value) => String(value ?? '').trim())
            .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function normalizeBehaviorId(value) {
    const normalized = String(value ?? '').trim();
    return /^behavior\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalized) ? normalized : null;
}
