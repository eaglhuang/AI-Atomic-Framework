import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyPayloadHash, cidToShortId } from '../registry/atom-capsule.ts';
import {
  loadCapsuleRegistry,
  saveCapsuleRegistry,
  getRepoRegistryPath,
  upsertCapsuleEntry
} from '../registry/capsule-registry.ts';
import { verifyMapPayloadHash, mapCidToShortId } from '../registry/map-capsule.ts';
import {
  type MapRegistry,
  loadMapRegistry,
  saveMapRegistry,
  getRepoMapRegistryPath,
  upsertMapEntry
} from '../registry/map-capsule-registry.ts';

export interface RebuildRegistryResult {
  dryRun: boolean;
  backedUpTo: string | null;
  rebuiltEntries: number;
  orphanedCapsules: string[];
  missingCapsules: string[];
  skippedFiles: string[];
  errors: string[];
}

export interface RebuildMapsResult {
  dryRun: boolean;
  backedUpTo: string | null;
  rebuiltEntries: number;
  orphanedMaps: string[];
  merkleErrors: string[];
  errors: string[];
}

export function rebuildCapsuleRegistry(
  repositoryRoot: string,
  options: { dryRun?: boolean; backupDir?: string } = {}
): RebuildRegistryResult {
  const dryRun = options.dryRun ?? true;
  const vendorDir = path.join(repositoryRoot, 'vendor', 'atoms');
  const registryPath = getRepoRegistryPath(repositoryRoot);
  const backupDir = options.backupDir ?? path.join(repositoryRoot, '.atm', 'rescue-backup');

  const result: RebuildRegistryResult = {
    dryRun,
    backedUpTo: null,
    rebuiltEntries: 0,
    orphanedCapsules: [],
    missingCapsules: [],
    skippedFiles: [],
    errors: []
  };

  if (!existsSync(vendorDir)) {
    result.errors.push(`vendor/atoms/ directory not found at ${vendorDir}`);
    return result;
  }

  // Scan vendor/atoms/ for capsule JSON files
  const capsuleFiles = readdirSync(vendorDir).filter(
    (f) => f.endsWith('.json') && f !== 'capsule-registry.json'
  );

  const rebuiltRegistry = {
    schemaVersion: 'atm.capsule-registry.v0.1' as const,
    updatedAt: new Date().toISOString(),
    entries: {} as Record<string, ReturnType<typeof loadCapsuleRegistry>['entries'][string]>
  };

  for (const filename of capsuleFiles) {
    const filePath = path.join(vendorDir, filename);
    try {
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      const cid: string = content.cid;
      const compressedPayload: string = content.compressedPayload ?? content.bundle
        ? Buffer.from(JSON.stringify(content.bundle ?? {})).toString('base64')
        : '';

      if (!cid || !cid.startsWith('atom:cid:')) {
        result.skippedFiles.push(`${filename}: no valid atom:cid`);
        continue;
      }

      if (compressedPayload && !verifyPayloadHash(cid, compressedPayload)) {
        result.errors.push(`${filename}: hash verification failed for ${cid}`);
        continue;
      }

      const shortId = cidToShortId(cid);
      const atomId: string = content.bundle?.atomId ?? shortId;
      const relPath = path.relative(repositoryRoot, filePath);
      upsertCapsuleEntry(rebuiltRegistry, cid, {
        atomId,
        humanName: content.bundle?.humanName ?? atomId,
        status: 'active',
        storageLocations: [relPath],
        exportedAt: content.importedAt ?? new Date().toISOString(),
        previousCid: null,
        nextCid: null,
        advisories: []
      });
      result.rebuiltEntries++;

      // Check if the shortId matches the filename
      if (!filename.startsWith(shortId)) {
        result.orphanedCapsules.push(`${filename} (cid short=${shortId})`);
      }
    } catch (err) {
      result.skippedFiles.push(`${filename}: parse error; ${err}`);
    }
  }

  // Check for entries in existing registry that lack vendor files
  if (existsSync(registryPath)) {
    const existingRegistry = loadCapsuleRegistry(registryPath);
    for (const cid of Object.keys(existingRegistry.entries)) {
      if (!rebuiltRegistry.entries[cid]) {
        result.missingCapsules.push(cid);
      }
    }
  }

  if (!dryRun) {
    // Backup existing registry
    if (existsSync(registryPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `capsule-registry.${ts}.json`);
      writeFileSync(backupPath, readFileSync(registryPath));
      result.backedUpTo = backupPath;
    }
    mkdirSync(path.dirname(registryPath), { recursive: true });
    saveCapsuleRegistry(rebuiltRegistry, registryPath);
  }

  return result;
}

export function rebuildMapRegistry(
  repositoryRoot: string,
  options: { dryRun?: boolean; backupDir?: string } = {}
): RebuildMapsResult {
  const dryRun = options.dryRun ?? true;
  const vendorMapsDir = path.join(repositoryRoot, 'vendor', 'maps');
  const mapRegistryPath = getRepoMapRegistryPath(repositoryRoot);
  const capsuleRegistryPath = getRepoRegistryPath(repositoryRoot);
  const backupDir = options.backupDir ?? path.join(repositoryRoot, '.atm', 'rescue-backup');

  const result: RebuildMapsResult = {
    dryRun,
    backedUpTo: null,
    rebuiltEntries: 0,
    orphanedMaps: [],
    merkleErrors: [],
    errors: []
  };

  if (!existsSync(vendorMapsDir)) {
    result.errors.push(`vendor/maps/ directory not found at ${vendorMapsDir}`);
    return result;
  }

  const knownAtomCids = new Set<string>();
  if (existsSync(capsuleRegistryPath)) {
    const capsuleReg = loadCapsuleRegistry(capsuleRegistryPath);
    for (const cid of Object.keys(capsuleReg.entries)) {
      knownAtomCids.add(cid);
    }
  }

  const mapFiles = readdirSync(vendorMapsDir).filter(
    (f) => f.endsWith('.json') && f !== 'map-registry.json'
  );

  const rebuiltRegistry: MapRegistry = {
    schemaVersion: 'atm.map-registry.v0.1',
    updatedAt: new Date().toISOString(),
    currentPointers: {},
    entries: {}
  };

  for (const filename of mapFiles) {
    const filePath = path.join(vendorMapsDir, filename);
    try {
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      const mapCid: string = content.mapCid;
      const bundle = content.bundle;

      if (!mapCid || !mapCid.startsWith('map:cid:')) {
        result.errors.push(`${filename}: no valid map:cid`);
        continue;
      }

      // Verify Merkle tree
      const members: Array<{ atomCid: string }> = bundle?.members ?? [];
      const memberCids = members.map((m) => m.atomCid);
      const missingAtoms = memberCids.filter((cid) => knownAtomCids.size > 0 && !knownAtomCids.has(cid));
      if (missingAtoms.length > 0) {
        result.merkleErrors.push(`${mapCid}: missing atom CIDs: ${missingAtoms.slice(0, 3).join(', ')}`);
      }

      const shortId = mapCidToShortId(mapCid);
      const relPath = path.relative(repositoryRoot, filePath);
      const mapId: string = bundle?.mapId ?? shortId;
      upsertMapEntry(rebuiltRegistry, mapCid, {
        mapId,
        humanName: bundle?.humanName ?? mapId,
        memberAtomCids: memberCids,
        storageLocations: [relPath],
        exportedAt: content.importedAt ?? new Date().toISOString(),
        previousMapCid: null,
        nextMapCid: null,
        status: 'active',
        advisories: []
      });
      rebuiltRegistry.currentPointers[mapId] = mapCid;
      result.rebuiltEntries++;
    } catch (err) {
      result.errors.push(`${filename}: parse error; ${err}`);
    }
  }

  if (!dryRun) {
    if (existsSync(mapRegistryPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `map-registry.${ts}.json`);
      writeFileSync(backupPath, readFileSync(mapRegistryPath));
      result.backedUpTo = backupPath;
    }
    mkdirSync(path.dirname(mapRegistryPath), { recursive: true });
    saveMapRegistry(rebuiltRegistry, mapRegistryPath);
  }

  return result;
}
