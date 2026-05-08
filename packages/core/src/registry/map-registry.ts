import type { AtomicMapRecord, MapRegistryEntryRecord } from '../index';
import { computeAtomicMapHash } from './map-hash.ts';
import { normalizeSemanticFingerprint } from './semantic-fingerprint.ts';
import { migrateRegistryStatus } from './status-migration.ts';

export interface CreateAtomicMapRegistryEntryOptions {
  readonly schemaPath?: string;
  readonly semanticFingerprint?: string | null;
  readonly lineageLogRef?: string;
  readonly ttl?: number;
  readonly pendingSfCalculation?: boolean;
  readonly status?: string | null;
  readonly governanceTier?: string | null;
}

export function createAtomicMapRegistryEntry(
  atomicMap: AtomicMapRecord,
  options: CreateAtomicMapRegistryEntryOptions = {}
): MapRegistryEntryRecord {
  const statusMigration = migrateRegistryStatus({
    entryType: 'map',
    status: options.status ?? 'draft',
    governanceTier: options.governanceTier ?? null
  });

  const entry: MapRegistryEntryRecord = {
    schemaId: 'atm.atomicMap',
    specVersion: atomicMap.specVersion,
    schemaPath: options.schemaPath ?? 'schemas/registry/atomic-map.schema.json',
    mapId: String(atomicMap.mapId).trim(),
    mapVersion: String(atomicMap.mapVersion).trim(),
    members: atomicMap.members.map((member) => ({
      atomId: String(member.atomId).trim(),
      version: String(member.version).trim()
    })),
    edges: atomicMap.edges.map((edge) => ({
      from: String(edge.from).trim(),
      to: String(edge.to).trim(),
      binding: String(edge.binding).trim()
    })),
    entrypoints: atomicMap.entrypoints.map((entrypoint) => String(entrypoint).trim()),
    qualityTargets: Object.fromEntries(
      Object.entries(atomicMap.qualityTargets).map(([key, value]) => [String(key).trim(), typeof value === 'string' ? value.trim() : value])
    ),
    mapHash: computeAtomicMapHash(atomicMap),
    status: statusMigration.status,
    governance: statusMigration.governance
  };

  const semanticFingerprint = normalizeSemanticFingerprint(options.semanticFingerprint ?? atomicMap.semanticFingerprint ?? null);
  if (semanticFingerprint) {
    entry.semanticFingerprint = semanticFingerprint;
  } else if (options.pendingSfCalculation === true || atomicMap.pendingSfCalculation === true) {
    entry.semanticFingerprint = null;
    entry.pendingSfCalculation = true;
  }

  const lineageLogRef = options.lineageLogRef ?? atomicMap.lineageLogRef;
  if (lineageLogRef) {
    entry.lineageLogRef = lineageLogRef;
  }

  const ttl = options.ttl ?? atomicMap.ttl;
  if (typeof ttl === 'number') {
    entry.ttl = ttl;
  }

  if (options.pendingSfCalculation === true || atomicMap.pendingSfCalculation === true) {
    entry.pendingSfCalculation = true;
  }

  return entry;
}

export function isAtomicMapRegistryEntry(value: unknown): value is MapRegistryEntryRecord {
  return Boolean(value && typeof value === 'object' && (value as MapRegistryEntryRecord).schemaId === 'atm.atomicMap');
}

export function validateAtomicMapRegistryEntryHash(entry: MapRegistryEntryRecord) {
  const expected = computeAtomicMapHash(entry);
  return {
    ok: entry.mapHash === expected,
    actual: entry.mapHash,
    expected
  };
}
