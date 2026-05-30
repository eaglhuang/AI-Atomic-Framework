import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message: string) {
  console.error(`[validate:atom-id-to-cid] Error: ${message}`);
  process.exit(1);
}

function main() {
  const sidecarPath = path.resolve(root, 'atomic_workbench/atomization-coverage/atom-id-to-cid.json');
  const pathToAtomMapPath = path.resolve(root, 'atomic_workbench/atomization-coverage/path-to-atom-map.json');

  if (!existsSync(sidecarPath)) {
    fail(`atom-id-to-cid.json not found at ${sidecarPath}. Run backfill script first.`);
  }
  if (!existsSync(pathToAtomMapPath)) {
    fail(`path-to-atom-map.json not found at ${pathToAtomMapPath}`);
  }

  const sidecarData = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  const mapData = JSON.parse(readFileSync(pathToAtomMapPath, 'utf8'));

  // 1. Verify schemaVersion
  if (sidecarData.schemaVersion !== 'atm.atomIdToCid.v1') {
    fail(`schemaVersion must be 'atm.atomIdToCid.v1'. Got: ${sidecarData.schemaVersion}`);
  }

  const mappingsList = sidecarData.mappings || [];
  const mapMappings = mapData.mappings || [];

  // Extract map atom_ids
  const mapAtomIds = new Set<string>();
  for (const m of mapMappings) {
    if (m.atom_id) mapAtomIds.add(m.atom_id);
  }

  const sidecarAtomIds = new Set<string>();

  // 2. Verify mappings
  const cidRegex = /^atom:cid:[a-zA-Z0-9_-]{43,}$/;
  for (const mapping of mappingsList) {
    const { atom_id, atom_cid, sourcePath } = mapping;

    if (!atom_id) fail(`mapping entry missing 'atom_id'`);
    if (!atom_cid) fail(`mapping entry '${atom_id}' missing 'atom_cid'`);
    if (!sourcePath) fail(`mapping entry '${atom_id}' missing 'sourcePath'`);

    // Verify atom_id exists in path-to-atom-map.json
    if (!mapAtomIds.has(atom_id)) {
      fail(`atom_id '${atom_id}' in sidecar is not declared in path-to-atom-map.json`);
    }

    // Verify CID format
    if (!cidRegex.test(atom_cid)) {
      fail(`atom_cid '${atom_cid}' for '${atom_id}' has invalid CID format. Expected atom:cid:<base64url-sha256>`);
    }

    // Verify sourcePath exists on disk (skip placeholders)
    if (!sourcePath.startsWith('placeholder:')) {
      const fullSourcePath = path.resolve(root, sourcePath);
      if (!existsSync(fullSourcePath)) {
        fail(`Source path '${sourcePath}' for atom '${atom_id}' does not exist on disk`);
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

  console.log(`[validate:atom-id-to-cid] ok (${mappingsList.length} unique CID mappings verified, full two-way consistency pass)`);
}

main();
