/**
 * Owner-shard merge + reader for path-to-atom-map projection.
 * TASK-AAO-0106: deterministic merge, duplicate ownership errors, compatibility projection.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARDS_MANIFEST_REL = 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
export const PROJECTION_REL = 'atomic_workbench/atomization-coverage/path-to-atom-map.json';

export function resolveRepoPath(repoRoot, relativePath) {
  return resolve(repoRoot, relativePath);
}

export function loadManifest(repoRoot) {
  const manifestPath = resolveRepoPath(repoRoot, SHARDS_MANIFEST_REL);
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaId !== 'atm.pathToAtomMapShards.v1') {
    throw new Error(`Invalid path-to-atom-map shard manifest at ${manifestPath}`);
  }
  if (!Array.isArray(manifest.shardPaths) || manifest.shardPaths.length === 0) {
    throw new Error(`Shard manifest at ${manifestPath} has no shardPaths`);
  }
  return manifest;
}

export function loadOwnerShard(repoRoot, shardRelativePath) {
  const shardPath = resolveRepoPath(repoRoot, shardRelativePath);
  if (!existsSync(shardPath)) {
    throw new Error(`Owner shard not found: ${shardRelativePath}`);
  }
  const shard = JSON.parse(readFileSync(shardPath, 'utf8'));
  if (shard?.schemaId !== 'atm.pathToAtomMapOwnerShard.v1') {
    throw new Error(`Invalid owner shard schema at ${shardRelativePath}`);
  }
  if (!Array.isArray(shard.mappings)) {
    throw new Error(`Owner shard ${shardRelativePath} missing mappings array`);
  }
  return shard;
}

function computeSummary(mappings) {
  const atoms = new Set();
  let debtItems = 0;
  for (const mapping of mappings) {
    if (mapping.atom_id) atoms.add(mapping.atom_id);
    if (mapping.coverage_status === 'debt' || mapping.coverage_status === 'planned') {
      debtItems += 1;
    }
  }
  return {
    total_production_paths: mappings.length,
    mapped_paths: mappings.length,
    coverage_percentage: mappings.length > 0 ? 100 : 0,
    atoms_defined: atoms.size,
    atoms_with_evidence: 0,
    debt_items: debtItems,
    core_wave1_completed: true
  };
}

/**
 * Deterministically merge owner shards. Duplicate path_pattern ownership fails closed.
 */
export function mergeOwnerShards(repoRoot, manifest = loadManifest(repoRoot)) {
  if (!manifest) {
    throw new Error('Owner shard manifest is required for mergeOwnerShards');
  }

  const shardPaths = [...manifest.shardPaths].sort((left, right) => left.localeCompare(right));
  const shardOwnershipByPatternAndAtom = new Map();
  const mergedMappings = [];

  for (const shardRelativePath of shardPaths) {
    const shard = loadOwnerShard(repoRoot, shardRelativePath);
    const ownerId = String(shard.owner ?? shardRelativePath);

    for (const mapping of shard.mappings) {
      const pathPattern = String(mapping.path_pattern ?? '').trim();
      if (!pathPattern) {
        throw new Error(`Owner shard ${shardRelativePath} contains mapping without path_pattern`);
      }

      const ownershipKey = `${pathPattern}\0${String(mapping.atom_id ?? '')}`;
      const existing = shardOwnershipByPatternAndAtom.get(ownershipKey);
      if (existing && existing.ownerId !== ownerId) {
        throw new Error(
          `Duplicate path_pattern + atom_id ownership for "${pathPattern}" `
          + `(atom_id=${String(mapping.atom_id ?? '')}) between shards `
          + `"${existing.shardRelativePath}" (owner=${existing.ownerId}) and `
          + `"${shardRelativePath}" (owner=${ownerId})`
        );
      }

      if (!existing) {
        shardOwnershipByPatternAndAtom.set(ownershipKey, { shardRelativePath, ownerId });
      }
      mergedMappings.push({ ...mapping });
    }
  }

  mergedMappings.sort((left, right) => left.path_pattern.localeCompare(right.path_pattern));

  return {
    schemaId: 'atm.pathToAtomMap.v1',
    schemaSource: 'docs/ATOMIZATION_COVERAGE_TAXONOMY.md#42-json-schema-草案-atmpathtoatommapv1',
    version: '1.0',
    timestamp: new Date().toISOString(),
    sharding: {
      strategy: 'owner-shards',
      manifestPath: SHARDS_MANIFEST_REL,
      shardCount: shardPaths.length
    },
    mappings: mergedMappings,
    summary: computeSummary(mergedMappings)
  };
}

export function loadPathToAtomMap(repoRoot) {
  const manifest = loadManifest(repoRoot);
  if (manifest) {
    return mergeOwnerShards(repoRoot, manifest);
  }

  const projectionPath = resolveRepoPath(repoRoot, PROJECTION_REL);
  if (!existsSync(projectionPath)) {
    throw new Error(`path-to-atom-map projection not found at ${projectionPath}`);
  }
  return JSON.parse(readFileSync(projectionPath, 'utf8'));
}

function stableMappingKey(mapping) {
  return JSON.stringify({
    path_pattern: mapping.path_pattern,
    atom_id: mapping.atom_id,
    capability: mapping.capability,
    coverage_status: mapping.coverage_status,
    source_task: mapping.source_task ?? null
  });
}

export function validateProjectionMatchesShards(repoRoot) {
  const manifest = loadManifest(repoRoot);
  if (!manifest) {
    return { ok: true, skipped: true, reason: 'no-shard-manifest' };
  }

  const projectionPath = resolveRepoPath(repoRoot, manifest.projectionPath ?? PROJECTION_REL);
  if (!existsSync(projectionPath)) {
    return {
      ok: false,
      reason: 'projection-missing',
      detail: `Projection missing at ${manifest.projectionPath ?? PROJECTION_REL}`
    };
  }

  const projection = JSON.parse(readFileSync(projectionPath, 'utf8'));
  const merged = mergeOwnerShards(repoRoot, manifest);

  const projectionKeys = (projection.mappings ?? []).map(stableMappingKey).sort();
  const mergedKeys = (merged.mappings ?? []).map(stableMappingKey).sort();

  if (projectionKeys.length !== mergedKeys.length) {
    return {
      ok: false,
      reason: 'projection-count-mismatch',
      detail: `projection mappings=${projectionKeys.length}, merged shards=${mergedKeys.length}`
    };
  }

  for (let index = 0; index < projectionKeys.length; index += 1) {
    if (projectionKeys[index] !== mergedKeys[index]) {
      return {
        ok: false,
        reason: 'projection-semantic-mismatch',
        detail: `Projection differs from deterministic shard merge at index ${index}`
      };
    }
  }

  return { ok: true, skipped: false, mappingCount: projectionKeys.length };
}

export function writeProjectionFromShards(repoRoot, manifest = loadManifest(repoRoot)) {
  if (!manifest) {
    throw new Error('Cannot write projection without shard manifest');
  }
  const merged = mergeOwnerShards(repoRoot, manifest);
  const projectionPath = resolveRepoPath(repoRoot, manifest.projectionPath ?? PROJECTION_REL);
  writeFileSync(projectionPath, `${JSON.stringify(merged)}\n`, 'utf8');
  return { projectionPath, mappingCount: merged.mappings.length };
}

const invokedAsScript = (() => {
  try {
    const selfPath = fileURLToPath(import.meta.url);
    const entry = process.argv[1] ? resolve(process.argv[1]) : '';
    return selfPath === entry;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  const repoRoot = resolve(process.argv[2] ?? process.cwd());
  const command = process.argv[3] ?? 'merge';
  if (command === 'merge' || command === 'write-projection') {
    const result = writeProjectionFromShards(repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else if (command === 'validate') {
    const result = validateProjectionMatchesShards(repoRoot);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(2);
  }
}
