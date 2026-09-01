import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeRelativePath } from '../commit-scope-policy.ts';
import {
  readTaskWriteAuthority,
  resolveTaskHistoryOwnerTaskId,
} from '../../../../../core/src/broker/cross-task-mutation-guard.ts';

export function isExplicitTerminalHistoryCleanupArtifact(
  cwd: string,
  filePath: string,
  currentTaskId: string,
  declaredScope: readonly string[],
  isCurrentTaskGovernanceArtifact: (filePath: string) => boolean,
) {
  const normalized = normalizeRelativePath(filePath);
  const current = String(currentTaskId ?? '').trim().toUpperCase();
  const ownerTaskId = resolveTaskHistoryOwnerTaskId(cwd, normalized);
  if (!ownerTaskId || ownerTaskId === current) return false;
  if (!/^\.atm\/history\/evidence\/[^/]+\.json$/i.test(normalized)) return false;
  if (/\.(?:closure-packet|bundle-manifest|seal-and-commit|publication-input-manifest|publication-preflight)\.json$/i.test(normalized)) return false;
  if (!declaredScope.some((scope) => normalizeRelativePath(scope) === normalized)) return false;
  const historyOnlyScope = declaredScope.every((scope) => {
    const candidate = normalizeRelativePath(scope);
    return Boolean(candidate) && !/[*?]/.test(candidate) && !/[\\/]$/.test(candidate)
      && (isCurrentTaskGovernanceArtifact(candidate) || /^\.atm\/history\/evidence\/[^/]+\.json$/i.test(candidate));
  });
  if (!historyOnlyScope || readTaskWriteAuthority(cwd, ownerTaskId) !== 'terminal') return false;
  try {
    const evidence = JSON.parse(readFileSync(path.join(cwd, normalized), 'utf8')) as Record<string, unknown>;
    return typeof evidence.taskId === 'string' && evidence.taskId.trim().toUpperCase() === ownerTaskId;
  } catch {
    return false;
  }
}
