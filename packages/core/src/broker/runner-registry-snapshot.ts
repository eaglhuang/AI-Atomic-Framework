import { createHash } from 'node:crypto';
import { createRunnerVersionRegistry, type PublishedRunnerVersion, type RunnerVersionRegistry } from './runner-version-registry.ts';

export const RUNNER_REGISTRY_SNAPSHOT_SCHEMA = 'atm.runnerRegistrySnapshot.v1' as const;

export interface RunnerRegistrySnapshot {
  readonly schemaId: typeof RUNNER_REGISTRY_SNAPSHOT_SCHEMA;
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly policyVersion: string;
  readonly versions: readonly PublishedRunnerVersion[];
  readonly snapshotDigest: string;
}

export interface RunnerRegistrySnapshotSource {
  readSnapshot(): RunnerRegistrySnapshot;
}

export function buildRunnerRegistrySnapshot(input: {
  readonly versions: readonly PublishedRunnerVersion[];
  readonly generatedAt: string;
  readonly policyVersion: string;
}): RunnerRegistrySnapshot {
  const core = {
    schemaId: RUNNER_REGISTRY_SNAPSHOT_SCHEMA,
    specVersion: '0.1.0' as const,
    generatedAt: input.generatedAt,
    policyVersion: input.policyVersion,
    versions: normalizePublishedRunnerVersions(input.versions)
  };
  return { ...core, snapshotDigest: digestCanonicalJson(core) };
}

export function readRunnerRegistrySnapshotValue(snapshot: RunnerRegistrySnapshot): RunnerRegistrySnapshot {
  const rebuilt = buildRunnerRegistrySnapshot({
    versions: snapshot.versions,
    generatedAt: snapshot.generatedAt,
    policyVersion: snapshot.policyVersion
  });
  if (rebuilt.snapshotDigest !== snapshot.snapshotDigest) {
    throw new Error(`Runner registry snapshot digest mismatch: expected ${snapshot.snapshotDigest}, got ${rebuilt.snapshotDigest}`);
  }
  return rebuilt;
}

export function createRegistryFromSnapshot(snapshot: RunnerRegistrySnapshot): RunnerVersionRegistry {
  return createRunnerVersionRegistry(readRunnerRegistrySnapshotValue(snapshot).versions);
}

export function digestCanonicalJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function normalizePublishedRunnerVersions(versions: readonly PublishedRunnerVersion[]): readonly PublishedRunnerVersion[] {
  return [...versions]
    .map((version) => ({
      ...version,
      publishedSurfaces: sortedStrings(version.publishedSurfaces),
      capabilityProof: {
        validators: sortedStrings(version.capabilityProof?.validators ?? []),
        schemas: sortedStrings(version.capabilityProof?.schemas ?? [])
      }
    }))
    .sort((a, b) =>
      a.sealedSourceSha.localeCompare(b.sealedSourceSha) ||
      a.aggregateInputTreeHash.localeCompare(b.aggregateInputTreeHash) ||
      a.publishedAt.localeCompare(b.publishedAt)
    );
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort((a, b) => a.localeCompare(b)).map((key) => [key, sortJson(record[key])]));
}
