import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runMapIntegrationTest } from './map-integration.ts';
import { createTestReportMetrics } from './metrics-collector.ts';

export const propagationTriggerBehaviors = Object.freeze(['split', 'merge', 'atomize', 'infect', 'evolve']);

export function shouldPropagateBehavior(behavior: any) {
  if (typeof behavior !== 'string') {
    return false;
  }
  return propagationTriggerBehaviors.includes(behavior.trim().toLowerCase());
}

export function discoverMapsForAtom(atomId: any, options: any) {
  const normalizedOptions = options || {};
  const repositoryRoot = path.resolve(normalizedOptions.repositoryRoot ?? process.cwd());
  const discovered = new Set<string>();
  for (const mapId of discoverMapsFromRegistry(atomId, { repositoryRoot, registryDocument: normalizedOptions.registryDocument, registryPath: normalizedOptions.registryPath })) {
    discovered.add(mapId);
  }
  for (const mapId of discoverMapsFromFilesystem(atomId, { repositoryRoot })) {
    discovered.add(mapId);
  }
  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function runPropagationIntegration(atomId: any, options: any) {
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

function discoverMapsFromRegistry(atomId: any, options: any) {
  const normalizedOptions = options || {};
  const registryDocument = normalizedOptions.registryDocument ?? readRegistryDocument(path.resolve(normalizedOptions.repositoryRoot ?? process.cwd(), normalizedOptions.registryPath ?? 'atomic-registry.json'));
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  return entries
    .filter((entry: any) => entry?.schemaId === 'atm.atomicMap')
    .filter((entry: any) => Array.isArray(entry?.members) && entry.members.some((member: any) => String(member?.atomId || '').trim() === atomId))
    .map((entry: any) => String(entry.mapId || '').trim())
    .filter(Boolean);
}

function discoverMapsFromFilesystem(atomId: any, options: any) {
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

function tryReadMapIdForAtom(specPath: any, atomId: any) {
  if (!existsSync(specPath)) {
    return null;
  }
  try {
    const specDocument = JSON.parse(readFileSync(specPath, 'utf8'));
    const hasAtom = Array.isArray(specDocument?.members)
      && specDocument.members.some((member: any) => String(member?.atomId || '').trim() === atomId);
    if (!hasAtom) {
      return null;
    }
    return String(specDocument?.mapId || '').trim() || null;
  } catch {
    return null;
  }
}

function readRegistryDocument(registryPath: any) {
  if (!existsSync(registryPath)) {
    return { entries: [] };
  }
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}
