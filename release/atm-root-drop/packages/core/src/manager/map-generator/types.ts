import type { AtomicMapReplacementRecord, RegistryMapEdgeRecord, RegistryMapMemberRecord } from '../../index.ts';

export interface MapMember {
  atomId: string;
  version: string;
  role?: string;
  versionLineage?: string;
}

export interface MapEdge {
  from: string;
  to: string;
  binding: string;
  edgeKind?: string;
}

export interface MapReplacement {
  legacyUris: string[];
  mode?: string;
  evidenceRefs?: string[];
}

export interface NormalizedRequest {
  members: MapMember[];
  edges: MapEdge[];
  entrypoints: string[];
  qualityTargets: Record<string, string | number | boolean>;
  mapVersion: string;
  specVersion?: string;
  replacement?: MapReplacement | null;
  pendingSfCalculation?: boolean;
}

export interface MapPaths {
  workbenchPath: string;
  specPath: string;
  testPath: string;
  reportPath: string;
}

export interface GenerateAtomicMapOptions {
  repositoryRoot?: string;
  registryPath?: string;
  dryRun?: boolean;
  force?: boolean;
  mapId?: string | null;
  status?: string;
  governanceTier?: string;
  catalogPath?: string;
  now?: string;
  overwriteExisting?: boolean;
  testContent?: string;
  registryDocument?: Record<string, unknown>;
}

export interface GenerateAtomicMapResult {
  ok: boolean;
  mapId: string | null;
  workbenchPath?: string | null;
  specPath?: string | null;
  testPath?: string | null;
  reportPath?: string | null;
  registryEntry?: RegistryEntry | null;
  registryPath?: string | null;
  catalogPath?: string | null;
  allocation?: MapIdAllocationRecord | null;
  testRun?: unknown | null;
  idempotent?: boolean;
  dryRun?: boolean;
  phases: PhaseRecord[];
  failedPhase?: string | null;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

export interface PhaseRecord {
  phase: string;
  ok: boolean;
  durationMs: number;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

export interface RegistryEntry {
  mapId: string;
  schemaId?: string;
  specVersion?: string;
  mapVersion?: string;
  members?: readonly RegistryMapMemberRecord[];
  edges?: readonly RegistryMapEdgeRecord[];
  replacement?: AtomicMapReplacementRecord;
  mapHash?: string;
  semanticFingerprint?: string | null;
  mapSemanticFingerprint?: string | null;
  pendingSfCalculation?: boolean;
  evidence?: readonly string[];
  location?: {
    workbenchPath?: string;
    specPath?: string;
    testPaths?: string[];
    reportPath?: string;
  };
}

export interface MapIdAllocationRecord {
  mapId: string;
  bucket: string;
  sequence: number;
  source: string;
  reservation: string | null;
}

export interface RegistryDocument {
  schemaId?: string;
  specVersion?: string;
  migration?: Record<string, unknown>;
  registryId?: string;
  generatedAt?: string;
  entries?: unknown[];
}

export interface AllocateOptions {
  repositoryRoot: string;
  registryPath: string;
  registryDocument: RegistryDocument;
  existingEntry: RegistryEntry | null;
  mapId?: string;
  force: boolean;
}

export interface RunTestOptions {
  repositoryRoot: string;
  specPath: string;
  testPath: string;
  reportPath: string;
  mapId: string;
  now?: string;
}

export interface HashPayloadInput {
  members: Array<{ atomId: string; version: string; role?: string }>;
  edges: Array<{ from: string; to: string; binding: string; edgeKind?: string }>;
  entrypoints: string[];
  replacement: MapReplacement | null;
}
