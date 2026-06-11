import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAtomCid } from '../packages/core/src/registry/atom-capsule.ts';
import { loadPathToAtomMap } from '../atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js';
import {
  ATOM_ID_TO_CID_SCHEMA_VERSION,
  buildPlaceholderAtomBundle,
  buildResolvedAtomBundle,
  isPlaceholderAtomSourcePath,
  type AtomIdToCidMapping
} from './lib/atom-id-to-cid.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_SCHEMA_VERSIONS = new Set(['atm.atomIdToCid.v1', ATOM_ID_TO_CID_SCHEMA_VERSION]);

function fail(message: string): never {
  console.error(`[validate:atom-id-to-cid] Error: ${message}`);
  process.exit(1);
}

function main() {
  const sidecarPath = path.resolve(root, 'atomic_workbench/atomization-coverage/atom-id-to-cid.json');
  if (!existsSync(sidecarPath)) {
    fail(`atom-id-to-cid.json not found at ${sidecarPath}. Run backfill script first.`);
  }

  const sidecarData = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  let mapData: ReturnType<typeof loadPathToAtomMap> | undefined;
  try {
    mapData = loadPathToAtomMap(root);
  } catch (error) {
    fail(`path-to-atom-map load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!mapData) {
    fail('path-to-atom-map load returned empty document');
  }
  const schemaVersion = String(sidecarData.schemaVersion ?? '');
  if (!VALID_SCHEMA_VERSIONS.has(schemaVersion)) {
    fail(`schemaVersion must be one of ${Array.from(VALID_SCHEMA_VERSIONS).join(', ')}. Got: ${schemaVersion}`);
  }

  const mappingsList = sidecarData.mappings || [];
  const mapMappings = mapData.mappings || [];

  // Extract map atom_ids
  const mapAtomIds = new Set<string>();
  for (const m of mapMappings) {
    if (m.atom_id) mapAtomIds.add(m.atom_id);
  }

  const sidecarAtomIds = new Set<string>();
  const cidRegex = /^atom:cid:[a-zA-Z0-9_-]{43,}$/;
  let placeholderCount = 0;
  const placeholderWarnings: string[] = [];
  for (const rawMapping of mappingsList) {
    const mapping = rawMapping as Partial<AtomIdToCidMapping> & Record<string, unknown>;
    const { atom_id, atom_cid, sourcePath, sourceKind } = mapping;

    if (!atom_id) fail(`mapping entry missing 'atom_id'`);
    if (!atom_cid) fail(`mapping entry '${atom_id}' missing 'atom_cid'`);
    if (!sourcePath) fail(`mapping entry '${atom_id}' missing 'sourcePath'`);
    if (schemaVersion === ATOM_ID_TO_CID_SCHEMA_VERSION && !sourceKind) {
      fail(`mapping entry '${atom_id}' missing 'sourceKind' in schema ${ATOM_ID_TO_CID_SCHEMA_VERSION}`);
    }

    // Verify atom_id exists in path-to-atom-map.json
    if (!mapAtomIds.has(atom_id)) {
      fail(`atom_id '${atom_id}' in sidecar is not declared in path-to-atom-map.json`);
    }

    // Verify CID format
    if (!cidRegex.test(atom_cid)) {
      fail(`atom_cid '${atom_cid}' for '${atom_id}' has invalid CID format. Expected atom:cid:<base64url-sha256>`);
    }

    const inferredSourceKind = isPlaceholderAtomSourcePath(sourcePath) ? 'placeholder' : 'source';
    const effectiveSourceKind = (sourceKind ?? inferredSourceKind) as 'source' | 'placeholder';
    if (sourceKind && sourceKind !== inferredSourceKind) {
      fail(`mapping entry '${atom_id}' has sourceKind='${sourceKind}' but sourcePath='${sourcePath}' does not match that kind`);
    }

    if (effectiveSourceKind === 'source') {
      const fullSourcePath = path.resolve(root, sourcePath);
      if (!existsSync(fullSourcePath)) {
        fail(`Source path '${sourcePath}' for atom '${atom_id}' does not exist on disk`);
      }
      const sourceContent = readFileSync(fullSourcePath, 'utf8');
      const expectedCid = computeAtomCid(buildResolvedAtomBundle(sourceContent));
      if (expectedCid !== atom_cid) {
        fail(`atom_cid mismatch for '${atom_id}': expected ${expectedCid} from source content, got ${atom_cid}`);
      }
    } else {
      placeholderCount++;
      if (!isPlaceholderAtomSourcePath(sourcePath)) {
        fail(`Placeholder mapping '${atom_id}' must use a placeholder sourcePath. Got: ${sourcePath}`);
      }
      placeholderWarnings.push(`placeholder mapping '${atom_id}' has no real source file; validated via synthetic bundle only`);
      const expectedCid = computeAtomCid(buildPlaceholderAtomBundle(atom_id));
      if (expectedCid !== atom_cid) {
        fail(`atom_cid mismatch for placeholder '${atom_id}': expected ${expectedCid} from placeholder bundle, got ${atom_cid}`);
      }
    }

    sidecarAtomIds.add(atom_id);
  }

  // 3. Two-way check: verify all atoms from path-to-atom-map have CID mappings
  const missingAtoms: string[] = [];
  for (const mapAtomId of mapAtomIds) {
    if (!sidecarAtomIds.has(mapAtomId)) {
      missingAtoms.push(mapAtomId);
    }
  }

  if (missingAtoms.length > 0) {
    fail(`The following unique atoms in path-to-atom-map.json lack CID mappings in sidecar: ${missingAtoms.join(', ')}`);
  }

  if (placeholderWarnings.length > 0) {
    console.warn(`[validate:atom-id-to-cid] warnings:`);
    for (const warning of placeholderWarnings) {
      console.warn(`  - ${warning}`);
    }
  }

  console.log(`[validate:atom-id-to-cid] ok (${mappingsList.length} unique CID mappings verified, ${placeholderCount} placeholder entries, full two-way consistency pass with CID recomputation)`);
}

main();
