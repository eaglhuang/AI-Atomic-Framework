import type { MapRegistryEntryRecord, RegistryEntryRecord } from '../index.ts';

export function isAtomEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is RegistryEntryRecord {
  return Object.hasOwn(entry, 'atomId');
}

export function isMapEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is MapRegistryEntryRecord {
  return Object.hasOwn(entry, 'mapId');
}

export function findVersionRecord(entry: RegistryEntryRecord, version: string) {
  if (!entry.versions || !Array.isArray(entry.versions)) {
    return null;
  }
  return entry.versions.find((record) => record.version === version) ?? null;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}

