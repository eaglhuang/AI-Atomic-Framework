import type {
  MapRegistryEntryRecord,
  RegistryDocument,
  RegistryDocumentEntryRecord,
  RegistryEntryRecord,
  RegistryVersionRecord
} from '../index';
import { normalizeSemanticFingerprint } from './semantic-fingerprint.ts';

export interface RegistryVersionHistoryMigrationOptions {
  readonly defaultVersion?: string;
  readonly timestamp?: string;
}

export interface RegistryEntryWithVersionHistory extends RegistryEntryRecord {
  readonly currentVersion?: string;
  readonly versions?: readonly RegistryVersionRecord[];
}

export interface RegistryDocumentWithVersionHistory extends Omit<RegistryDocument, 'entries'> {
  readonly entries: readonly (RegistryEntryWithVersionHistory | MapRegistryEntryRecord)[];
}

export function upcastRegistryDocumentVersionHistory(
  registryDocument: RegistryDocument,
  options: RegistryVersionHistoryMigrationOptions = {}
): RegistryDocumentWithVersionHistory {
  return {
    ...registryDocument,
    entries: Array.isArray(registryDocument.entries)
      ? registryDocument.entries.map((entry) => isAtomRegistryEntry(entry)
        ? upcastRegistryEntryVersionHistory(entry, options)
        : entry)
      : []
  };
}

export function upcastRegistryEntryVersionHistory(
  entry: RegistryEntryRecord,
  options: RegistryVersionHistoryMigrationOptions = {}
): RegistryEntryWithVersionHistory {
  const versions = normalizeRegistryVersionHistory(entry, options);
  const currentVersion =
    entry.currentVersion ??
    versions[versions.length - 1]?.version ??
    resolveRegistryVersion(entry, options);

  return {
    ...entry,
    currentVersion,
    versions
  };
}

export function normalizeRegistryVersionHistory(
  entry: RegistryEntryRecord,
  options: RegistryVersionHistoryMigrationOptions = {}
): readonly RegistryVersionRecord[] {
  const existingVersions = Array.isArray(entry.versions) && entry.versions.length > 0
    ? entry.versions.map((version) => normalizeRegistryVersionRecord(version))
    : [];

  if (existingVersions.length > 0) {
    return existingVersions;
  }

  return [createRegistryVersionRecord(entry, resolveRegistryVersion(entry, options), options.timestamp)];
}

export function createRegistryVersionRecord(
  entry: RegistryEntryRecord,
  version: string,
  timestamp = new Date().toISOString()
): RegistryVersionRecord {
  const selfVerification = entry.selfVerification;
  const semanticFingerprint = normalizeSemanticFingerprint(entry.semanticFingerprint ?? null);
  const record: RegistryVersionRecord = {
    version,
    specHash: selfVerification?.specHash ?? entry.hashLock.digest,
    codeHash: selfVerification?.codeHash ?? entry.hashLock.digest,
    testHash: selfVerification?.testHash ?? entry.hashLock.digest,
    timestamp
  };
  if (semanticFingerprint) {
    record.semanticFingerprint = semanticFingerprint;
  } else if (entry.semanticFingerprint === null) {
    record.semanticFingerprint = null;
  }
  return record;
}

function normalizeRegistryVersionRecord(versionRecord: RegistryVersionRecord): RegistryVersionRecord {
  const semanticFingerprint = normalizeSemanticFingerprint(versionRecord.semanticFingerprint ?? null);
  const record: RegistryVersionRecord = {
    version: String(versionRecord.version).trim(),
    specHash: String(versionRecord.specHash).trim(),
    codeHash: String(versionRecord.codeHash).trim(),
    testHash: String(versionRecord.testHash).trim(),
    timestamp: String(versionRecord.timestamp).trim()
  };
  if (semanticFingerprint) {
    record.semanticFingerprint = semanticFingerprint;
  } else if (versionRecord.semanticFingerprint === null) {
    record.semanticFingerprint = null;
  }
  return record;
}

function resolveRegistryVersion(
  entry: RegistryEntryRecord,
  options: RegistryVersionHistoryMigrationOptions = {}
): string {
  const fallbackVersion = options.defaultVersion ?? entry.currentVersion ?? entry.atomVersion ?? entry.specVersion;
  return String(fallbackVersion || '0.1.0').trim();
}

function isAtomRegistryEntry(entry: RegistryDocumentEntryRecord): entry is RegistryEntryRecord {
  return entry?.schemaId === 'atm.atomicSpec';
}
