import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runMapIntegrationTest } from './map-integration.ts';
import { createTestReportMetrics } from './metrics-collector.ts';

export const propagationTriggerBehaviors = Object.freeze(['split', 'merge', 'atomize', 'infect']);

export function shouldPropagateBehavior(behavior) {
  if (typeof behavior !== 'string') {
    return false;
  }
  return propagationTriggerBehaviors.includes(behavior.trim().toLowerCase());
}

export function discoverMapsForAtom(atomId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const discovered = new Set();
  for (const mapId of discoverMapsFromRegistry(atomId, { repositoryRoot, registryDocument: options.registryDocument, registryPath: options.registryPath })) {
    discovered.add(mapId);
  }
  for (const mapId of discoverMapsFromFilesystem(atomId, { repositoryRoot })) {
    discovered.add(mapId);
  }
  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function runPropagationIntegration(atomId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const requestedBehavior = options.behavior ?? null;
  const behaviorTriggersPropagation = requestedBehavior == null ? true : shouldPropagateBehavior(requestedBehavior);
  const maps = discoverMapsForAtom(atomId, { repositoryRoot, registryDocument: options.registryDocument, registryPath: options.registryPath });
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
    now: options.now,
    writeReport: options.writeReport
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

function discoverMapsFromRegistry(atomId, options = {}) {
  const registryDocument = options.registryDocument ?? readRegistryDocument(path.resolve(options.repositoryRoot ?? process.cwd(), options.registryPath ?? 'atomic-registry.json'));
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  return entries
    .filter((entry) => entry?.schemaId === 'atm.atomicMap')
    .filter((entry) => Array.isArray(entry?.members) && entry.members.some((member) => String(member?.atomId || '').trim() === atomId))
    .map((entry) => String(entry.mapId || '').trim())
    .filter(Boolean);
}

function discoverMapsFromFilesystem(atomId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
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
  } catch {
    return null;
  }
}

function readRegistryDocument(registryPath) {
  if (!existsSync(registryPath)) {
    return { entries: [] };
  }
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}