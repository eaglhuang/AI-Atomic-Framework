import type { MapRegistryEntryRecord, RegistryEntryRecord } from '../index.ts';
export declare function isAtomEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is RegistryEntryRecord;
export declare function isMapEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is MapRegistryEntryRecord;
export declare function findVersionRecord(entry: RegistryEntryRecord, version: string): any;
export declare function cloneJson<T>(value: T): T;
export declare function toPortablePath(value: string): string;
