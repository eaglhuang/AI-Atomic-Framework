import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isRecord } from '../shared-utils.ts';

export const EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID = 'atm.evidenceBundleManifest.v1' as const;

export interface EvidenceBundleManifest {
  readonly schemaId: typeof EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID;
  readonly taskId: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly freshValidationPasses: readonly string[];
  readonly staleValidationPasses: readonly string[];
  readonly commandRuns: readonly Record<string, unknown>[];
  readonly artifactPaths: readonly string[];
}

export function evidenceBundleManifestRelativePath(taskId: string): string {
  return `.atm/history/evidence/${taskId}.bundle-manifest.json`;
}

export function evidenceBundleManifestPathForTask(cwd: string, taskId: string): string {
  return path.join(cwd, evidenceBundleManifestRelativePath(taskId));
}

export function readEvidenceBundleManifest(
  cwd: string,
  taskId: string,
): EvidenceBundleManifest | null {
  const manifestPath = evidenceBundleManifestPathForTask(cwd, taskId);
  if (!existsSync(manifestPath)) return null;

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (!isRecord(parsed) || parsed.schemaId !== EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID) return null;
  if (typeof parsed.taskId !== 'string' || parsed.taskId !== taskId) return null;

  return {
    schemaId: EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID,
    taskId,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : 'unknown',
    freshValidationPasses: readStringArray(parsed.freshValidationPasses),
    staleValidationPasses: readStringArray(parsed.staleValidationPasses),
    commandRuns: Array.isArray(parsed.commandRuns) ? parsed.commandRuns.filter(isRecord) : [],
    artifactPaths: readStringArray(parsed.artifactPaths).map(normalizeRelativePath),
  };
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
