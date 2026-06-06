#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface RegistryVersionRecord {
  readonly version: string;
  readonly specHash: string;
  readonly codeHash: string;
  readonly testHash: string;
  readonly timestamp: string;
  readonly semanticFingerprint?: string | null;
}

interface RegistryEntryRecord {
  readonly schemaId?: string;
  readonly atomId?: string;
  readonly atomVersion?: string;
  readonly currentVersion?: string;
  readonly versions?: readonly RegistryVersionRecord[];
  readonly semanticFingerprint?: string | null;
  readonly specVersion?: string;
  readonly selfVerification?: {
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
  };
  readonly hashLock?: {
    readonly digest: string;
  };
}

interface AtomicRegistryDocument {
  readonly generatedAt: string;
  readonly entries: readonly RegistryEntryRecord[];
  readonly [key: string]: unknown;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'atomic-registry.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as AtomicRegistryDocument;

let changed = false;
const entries = registry.entries.map((entry) => {
  if (entry.schemaId !== 'atm.atomicSpec') {
    return entry;
  }

  const currentVersion = resolveCurrentVersion(entry);
  const normalizedExistingVersions = Array.isArray(entry.versions)
    ? entry.versions.map((versionRecord) => normalizeVersionRecord(versionRecord))
    : [];

  const hydratedVersions = normalizedExistingVersions.length > 0
    ? normalizedExistingVersions
    : [createVersionRecord(entry, currentVersion, registry.generatedAt)];

  const versions = reconcileCurrentVersionSnapshot(
    entry,
    currentVersion,
    hydratedVersions,
    registry.generatedAt
  );

  const nextEntry = {
    ...entry,
    currentVersion,
    versions
  };

  if (!isVersionStateUnchanged(entry, currentVersion, versions)) {
    changed = true;
  }

  return nextEntry;
});

if (changed) {
  writeFileSync(registryPath, `${JSON.stringify({ ...registry, entries }, null, 2)}\n`, 'utf8');
  console.log(`[backfill-registry-versions] updated ${path.relative(root, registryPath)}`);
} else {
  console.log('[backfill-registry-versions] no changes');
}

function resolveCurrentVersion(entry: RegistryEntryRecord): string {
  return String(entry.currentVersion ?? entry.atomVersion ?? entry.specVersion ?? '0.1.0').trim();
}

function createVersionRecord(
  entry: RegistryEntryRecord,
  version: string,
  timestamp: string
): RegistryVersionRecord {
  const selfVerification = entry.selfVerification;
  if (!selfVerification) {
    throw new Error(`registry entry ${entry.atomId ?? '<unknown>'} is missing selfVerification`);
  }

  const versionRecord: RegistryVersionRecord = {
    version,
    specHash: selfVerification.specHash,
    codeHash: selfVerification.codeHash,
    testHash: selfVerification.testHash,
    timestamp
  };

  const semanticFingerprint = normalizeSemanticFingerprint(entry.semanticFingerprint);
  return semanticFingerprint === undefined
    ? versionRecord
    : {
        ...versionRecord,
        semanticFingerprint
      };
}

function reconcileCurrentVersionSnapshot(
  entry: RegistryEntryRecord,
  currentVersion: string,
  versions: readonly RegistryVersionRecord[],
  fallbackTimestamp: string
): readonly RegistryVersionRecord[] {
  const selfVerification = entry.selfVerification;
  if (!selfVerification) {
    return versions;
  }

  const index = versions.findIndex((versionRecord) => versionRecord.version === currentVersion);
  const normalizedTimestamp = index >= 0
    ? String(versions[index].timestamp).trim()
    : String(fallbackTimestamp).trim();

  const alignedBase: RegistryVersionRecord = {
    version: currentVersion,
    specHash: String(selfVerification.specHash).trim(),
    codeHash: String(selfVerification.codeHash).trim(),
    testHash: String(selfVerification.testHash).trim(),
    timestamp: normalizedTimestamp
  };

  const semanticFingerprint = normalizeSemanticFingerprint(entry.semanticFingerprint);
  const alignedRecord = semanticFingerprint === undefined
    ? alignedBase
    : {
        ...alignedBase,
        semanticFingerprint
      };

  if (index < 0) {
    return [...versions, alignedRecord];
  }

  if (areVersionRecordsEqual(versions[index], alignedRecord)) {
    return versions;
  }

  const nextVersions = [...versions];
  nextVersions[index] = alignedRecord;
  return nextVersions;
}

function normalizeVersionRecord(versionRecord: RegistryVersionRecord): RegistryVersionRecord {
  const normalizedBase: RegistryVersionRecord = {
    version: String(versionRecord.version).trim(),
    specHash: String(versionRecord.specHash).trim(),
    codeHash: String(versionRecord.codeHash).trim(),
    testHash: String(versionRecord.testHash).trim(),
    timestamp: String(versionRecord.timestamp).trim()
  };

  const semanticFingerprint = normalizeSemanticFingerprint(versionRecord.semanticFingerprint);
  return semanticFingerprint === undefined
    ? normalizedBase
    : {
        ...normalizedBase,
        semanticFingerprint
      };
}

function isVersionStateUnchanged(
  entry: RegistryEntryRecord,
  currentVersion: string,
  versions: readonly RegistryVersionRecord[]
): boolean {
  if (!Array.isArray(entry.versions)) {
    return false;
  }

  const previousCurrentVersion = entry.currentVersion === undefined
    ? undefined
    : String(entry.currentVersion).trim();
  if (previousCurrentVersion !== currentVersion) {
    return false;
  }

  if (entry.versions.length !== versions.length) {
    return false;
  }

  for (let index = 0; index < versions.length; index += 1) {
    if (!areVersionRecordsEqual(normalizeVersionRecord(entry.versions[index]), versions[index])) {
      return false;
    }
  }

  return true;
}

function areVersionRecordsEqual(left: RegistryVersionRecord, right: RegistryVersionRecord): boolean {
  return left.version === right.version
    && left.specHash === right.specHash
    && left.codeHash === right.codeHash
    && left.testHash === right.testHash
    && left.timestamp === right.timestamp
    && normalizeSemanticFingerprint(left.semanticFingerprint) === normalizeSemanticFingerprint(right.semanticFingerprint);
}

function normalizeSemanticFingerprint(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
