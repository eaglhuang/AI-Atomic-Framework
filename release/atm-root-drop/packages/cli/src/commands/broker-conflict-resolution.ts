import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateBrokerConflictResolutionAuthority } from '../../../core/src/team-runtime/permission-broker.ts';

/**
 * Read foreign task ids authorized by a single broker conflict resolution
 * artifact for the given claiming task. Mirrors the governed commit lane.
 */
export function readResolutionAuthorizedForeignTaskIds(
  cwd: string,
  artifactPath: string | null,
  taskId: string
): ReadonlySet<string> {
  if (!artifactPath?.trim()) return new Set();
  const absolutePath = path.resolve(cwd, artifactPath);
  if (!existsSync(absolutePath)) return new Set();
  try {
    const artifact = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    const primaryTaskId = String(artifact.primaryTaskId ?? '').trim().toUpperCase();
    const currentAllowedTaskId = String(artifact.currentAllowedTaskId ?? '').trim().toUpperCase();
    const blockedTaskIds = Array.isArray(artifact.blockedTaskIds)
      ? artifact.blockedTaskIds.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
      : [];
    if (
      artifact.schemaId !== 'atm.brokerConflictResolution.v1'
      || primaryTaskId !== taskId.toUpperCase()
      || currentAllowedTaskId !== taskId.toUpperCase()
    ) {
      return new Set();
    }
    if (!isCanonicalBrokerResolutionAuthorized(artifact, taskId)) {
      return new Set();
    }
    return new Set(blockedTaskIds);
  } catch {
    return new Set();
  }
}

/**
 * Merge resolution authorization from an explicit artifact path and from
 * `.atm/runtime/broker-conflict-resolutions/*.json` sidecars.
 */
export function collectResolutionAuthorizedForeignTaskIds(
  cwd: string,
  taskId: string,
  explicitArtifactPath?: string | null
): ReadonlySet<string> {
  const artifacts: Array<{ readonly artifact: Record<string, unknown>; readonly sourcePath: string }> = [];
  const seenSources = new Set<string>();
  const addArtifact = (sourcePath: string) => {
    const absolutePath = path.resolve(cwd, sourcePath);
    if (seenSources.has(absolutePath) || !existsSync(absolutePath)) return;
    seenSources.add(absolutePath);
    try {
      const artifact = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      if (artifact.schemaId === 'atm.brokerConflictResolution.v1') artifacts.push({ artifact, sourcePath });
    } catch {
      // Invalid sidecars remain fail-closed.
    }
  };

  if (explicitArtifactPath?.trim()) addArtifact(explicitArtifactPath);
  const resolutionsDir = path.join(cwd, '.atm', 'runtime', 'broker-conflict-resolutions');
  if (existsSync(resolutionsDir)) {
    for (const entry of readdirSync(resolutionsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      addArtifact(path.join('.atm', 'runtime', 'broker-conflict-resolutions', entry.name).replace(/\\/g, '/'));
    }
  }
  const normalizedTaskId = taskId.trim().toUpperCase();
  const merged = new Set<string>();
  for (const { artifact } of artifacts) {
    if (
      normalizeTaskId(artifact.primaryTaskId) !== normalizedTaskId
      || normalizeTaskId(artifact.currentAllowedTaskId) !== normalizedTaskId
      || !isCanonicalBrokerResolutionAuthorized(artifact, normalizedTaskId)
      || hasNewerOpposingAuthority(artifact, artifacts)
    ) continue;
    for (const foreignTaskId of readBlockedTaskIds(artifact)) merged.add(foreignTaskId);
  }
  return merged;
}

export function isConflictAuthorizedByBrokerResolution(
  conflictingTaskId: string | null | undefined,
  resolutionAuthorizedForeignTaskIds: ReadonlySet<string>
): boolean {
  const normalized = conflictingTaskId?.trim().toUpperCase();
  if (!normalized) return false;
  return resolutionAuthorizedForeignTaskIds.has(normalized);
}

function isCanonicalBrokerResolutionAuthorized(artifact: Record<string, unknown>, taskId: string): boolean {
  return evaluateBrokerConflictResolutionAuthority(artifact, taskId).authorized;
}

function normalizeTaskId(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function readBlockedTaskIds(artifact: Record<string, unknown>): readonly string[] {
  return Array.isArray(artifact.blockedTaskIds)
    ? artifact.blockedTaskIds.map(normalizeTaskId).filter(Boolean)
    : [];
}

function resolutionGroupKey(artifact: Record<string, unknown>): string {
  const participants = [
    normalizeTaskId(artifact.primaryTaskId),
    ...(Array.isArray(artifact.conflictingTaskIds) ? artifact.conflictingTaskIds.map(normalizeTaskId) : [])
  ].filter(Boolean).sort();
  const sharedPaths = Array.isArray(artifact.sharedPaths)
    ? artifact.sharedPaths.map((value) => String(value).replace(/\\/g, '/').trim()).filter(Boolean).sort()
    : [];
  return JSON.stringify({ participants, sharedPaths });
}

function authoritySortKey(artifact: Record<string, unknown>): string {
  return `${String(artifact.createdAt ?? '')}\u0000${String(artifact.resolutionId ?? '')}`;
}

function hasNewerOpposingAuthority(
  candidate: Record<string, unknown>,
  artifacts: readonly { readonly artifact: Record<string, unknown>; readonly sourcePath: string }[]
): boolean {
  const candidatePrimary = normalizeTaskId(candidate.primaryTaskId);
  const candidateKey = resolutionGroupKey(candidate);
  const candidateOrder = authoritySortKey(candidate);
  return artifacts.some(({ artifact: other }) => {
    const otherPrimary = normalizeTaskId(other.primaryTaskId);
    const otherConflicts = Array.isArray(other.conflictingTaskIds)
      ? other.conflictingTaskIds.map(normalizeTaskId)
      : [];
    return other !== candidate
      && resolutionGroupKey(other) === candidateKey
      && otherPrimary !== candidatePrimary
      && otherConflicts.includes(candidatePrimary)
      && normalizeTaskId(other.currentAllowedTaskId) === otherPrimary
      && isCanonicalBrokerResolutionAuthorized(other, otherPrimary)
      && authoritySortKey(other) > candidateOrder;
  });
}
