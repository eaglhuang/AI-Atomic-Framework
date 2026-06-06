/**
 * manifest/schema.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Schema version constant, path normalizer/resolver, SHA-256 helpers,
 * and the install manifest serializer. These utilities are shared by
 * both manifest/construct.ts and verify/*.ts so they live here to
 * avoid circular imports.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { InstallManifest, Sha256Digest } from './types.ts';

export const installManifestSchemaVersion = 'atm.installManifest.v0.1' as const;

export function sha256Bytes(input: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

export function sha256File(absolutePath: string): Sha256Digest {
  return sha256Bytes(readFileSync(absolutePath));
}

export function formatInstallManifest(manifest: InstallManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function normalizeManifestPath(candidatePath: string): string {
  const normalized = candidatePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`unsafe manifest path: ${candidatePath}`);
  }
  return normalized;
}

export function resolveRepositoryPath(repositoryRoot: string, manifestPath: string): string {
  const absoluteRoot = path.resolve(repositoryRoot);
  const resolvedPath = path.resolve(absoluteRoot, normalizeManifestPath(manifestPath));
  const comparableRoot = absoluteRoot.toLowerCase();
  const comparablePath = resolvedPath.toLowerCase();
  if (comparablePath !== comparableRoot && !comparablePath.startsWith(`${comparableRoot}${path.sep}`)) {
    throw new Error(`manifest path escapes repository root: ${manifestPath}`);
  }
  return resolvedPath;
}
