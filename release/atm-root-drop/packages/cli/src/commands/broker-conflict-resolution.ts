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
  const merged = new Set<string>();
  for (const foreignTaskId of readResolutionAuthorizedForeignTaskIds(cwd, explicitArtifactPath ?? null, taskId)) {
    merged.add(foreignTaskId);
  }
  const resolutionsDir = path.join(cwd, '.atm', 'runtime', 'broker-conflict-resolutions');
  if (!existsSync(resolutionsDir)) {
    return merged;
  }
  for (const entry of readdirSync(resolutionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const relativePath = path.join('.atm', 'runtime', 'broker-conflict-resolutions', entry.name).replace(/\\/g, '/');
    for (const foreignTaskId of readResolutionAuthorizedForeignTaskIds(cwd, relativePath, taskId)) {
      merged.add(foreignTaskId);
    }
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
