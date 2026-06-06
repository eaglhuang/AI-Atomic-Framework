import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cidToShortId } from './atom-capsule.ts';

export type CapsuleEntryStatus = 'active' | 'superseded' | 'rolled-back' | 'corrupted' | 'advisory';

export interface CapsuleRegistryEntry {
  atomId: string;
  humanName: string;
  sourceRepo?: string;
  sourceRef?: string;
  exportedAt: string;
  exportedBy?: string;
  previousCid: string | null;
  nextCid: string | null;
  status: CapsuleEntryStatus;
  storageLocations: string[];
  advisories: string[];
}

export interface CapsuleRegistry {
  schemaVersion: 'atm.capsule-registry.v0.1';
  updatedAt: string;
  entries: Record<string, CapsuleRegistryEntry>;
}

const GLOBAL_REGISTRY_PATH = path.join(os.homedir(), '.atm', 'capsule-registry.json');
const REPO_REGISTRY_FILENAME = path.join('vendor', 'atoms', 'capsule-registry.json');

export function loadCapsuleRegistry(registryPath: string): CapsuleRegistry {
  if (!existsSync(registryPath)) {
    return createEmptyRegistry();
  }
  try {
    const content = readFileSync(registryPath, 'utf-8');
    return JSON.parse(content) as CapsuleRegistry;
  } catch {
    return createEmptyRegistry();
  }
}

export function saveCapsuleRegistry(registry: CapsuleRegistry, registryPath: string): void {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  registry.updatedAt = new Date().toISOString();
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

export function getGlobalRegistryPath(): string {
  return GLOBAL_REGISTRY_PATH;
}

export function getRepoRegistryPath(repositoryRoot: string): string {
  return path.join(repositoryRoot, REPO_REGISTRY_FILENAME);
}

export function upsertCapsuleEntry(
  registry: CapsuleRegistry,
  cid: string,
  entry: Partial<CapsuleRegistryEntry> & { atomId: string; humanName: string }
): void {
  const existing = registry.entries[cid];
  registry.entries[cid] = {
    atomId: entry.atomId,
    humanName: entry.humanName,
    sourceRepo: entry.sourceRepo ?? existing?.sourceRepo,
    sourceRef: entry.sourceRef ?? existing?.sourceRef,
    exportedAt: entry.exportedAt ?? existing?.exportedAt ?? new Date().toISOString(),
    exportedBy: entry.exportedBy ?? existing?.exportedBy,
    previousCid: entry.previousCid !== undefined ? entry.previousCid : (existing?.previousCid ?? null),
    nextCid: entry.nextCid !== undefined ? entry.nextCid : (existing?.nextCid ?? null),
    status: entry.status ?? existing?.status ?? 'active',
    storageLocations: entry.storageLocations ?? existing?.storageLocations ?? [],
    advisories: entry.advisories ?? existing?.advisories ?? []
  };
}

export function linkCapsuleChain(
  registry: CapsuleRegistry,
  previousCid: string,
  nextCid: string
): void {
  const prev = registry.entries[previousCid];
  if (prev) {
    prev.nextCid = nextCid;
    prev.status = 'superseded';
  }
  const next = registry.entries[nextCid];
  if (next) {
    next.previousCid = previousCid;
  }
}

export function markCapsuleCorrupted(
  registry: CapsuleRegistry,
  cid: string,
  corruptedLocation: string
): void {
  const entry = registry.entries[cid];
  if (!entry) return;
  entry.storageLocations = entry.storageLocations.filter((loc) => loc !== corruptedLocation);
  if (entry.storageLocations.length === 0) {
    entry.status = 'corrupted';
  }
}

export function markCapsuleRolledBack(
  registry: CapsuleRegistry,
  cid: string
): void {
  const entry = registry.entries[cid];
  if (entry) {
    entry.status = 'rolled-back';
  }
}

export function addCapsuleAdvisory(
  registry: CapsuleRegistry,
  cid: string,
  advisory: string
): void {
  const entry = registry.entries[cid];
  if (!entry) return;
  if (!entry.advisories.includes(advisory)) {
    entry.advisories.push(advisory);
  }
  entry.status = 'advisory';
}

export function getCapsuleEntry(
  registry: CapsuleRegistry,
  cid: string
): CapsuleRegistryEntry | undefined {
  return registry.entries[cid];
}

export function listAdvisoryCids(registry: CapsuleRegistry): string[] {
  return Object.entries(registry.entries)
    .filter(([, entry]) => entry.status === 'advisory' || entry.advisories.length > 0)
    .map(([cid]) => cid);
}

export function syncRegistries(
  globalRegistry: CapsuleRegistry,
  repoRegistry: CapsuleRegistry,
  repoPath: string
): void {
  // Merge repo entries into global (global is superset)
  for (const [cid, entry] of Object.entries(repoRegistry.entries)) {
    if (!globalRegistry.entries[cid]) {
      globalRegistry.entries[cid] = { ...entry };
    } else {
      // Merge storage locations
      const existing = globalRegistry.entries[cid];
      for (const loc of entry.storageLocations) {
        if (!existing.storageLocations.includes(loc)) {
          existing.storageLocations.push(loc);
        }
      }
    }
  }

  // Update repo registry: only include entries with vendor/atoms storage in this repo
  for (const [cid, entry] of Object.entries(globalRegistry.entries)) {
    const repoVendorPath = path.join(repoPath, 'vendor', 'atoms', `${cidToShortId(cid)}.json`);
    if (existsSync(repoVendorPath) && !repoRegistry.entries[cid]) {
      repoRegistry.entries[cid] = { ...entry };
    }
  }
}

function createEmptyRegistry(): CapsuleRegistry {
  return {
    schemaVersion: 'atm.capsule-registry.v0.1',
    updatedAt: new Date().toISOString(),
    entries: {}
  };
}
