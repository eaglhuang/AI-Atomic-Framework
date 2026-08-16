import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hasReconciliationEntitlement } from '../../../../core/src/broker/terminal-history-entitlement.ts';

export const ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE = 'ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE';

export type ProtectedGovernanceStateOperation = 'delete' | 'restore' | 'clean' | 'update-index-remove';

export interface ProtectedGovernanceStateViolation {
  readonly path: string;
  readonly pathClass: 'task-ledger' | 'task-event' | 'task-evidence';
  readonly ownerTaskId: string | null;
  readonly operation: ProtectedGovernanceStateOperation;
  readonly recovery: string;
}

export interface ProtectedGovernanceStateReport {
  readonly schemaId: 'atm.protectedGovernanceStateReport.v1';
  readonly ok: boolean;
  readonly code: typeof ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE | null;
  readonly summary: string | null;
  readonly violations: readonly ProtectedGovernanceStateViolation[];
}

function normalizeRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function classifyProtectedGovernanceStatePath(filePath: string): Pick<ProtectedGovernanceStateViolation, 'pathClass' | 'ownerTaskId'> | null {
  const normalized = normalizeRelativePath(filePath);
  let match = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
  if (match) return { pathClass: 'task-ledger', ownerTaskId: match[1]?.toUpperCase() ?? null };
  match = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
  if (match) return { pathClass: 'task-event', ownerTaskId: match[1]?.toUpperCase() ?? null };
  match = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:[.-][^/]*)?\.json$/i);
  if (match) return { pathClass: 'task-evidence', ownerTaskId: match[1]?.toUpperCase() ?? null };
  return null;
}

function listDiffNames(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string[] {
  try {
    return execFileSync('git', [...args, '-z'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    }).split('\0').map(normalizeRelativePath).filter(Boolean);
  } catch {
    return [];
  }
}

export function inspectProtectedGovernanceStateDestructiveChanges(input: {
  readonly cwd: string;
  readonly taskId: string;
  /** Optional isolated candidate index used by a sealed commit transaction. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * A commit resolver may share an index with unrelated retained residue.
   * In that case only deletions that will enter this commit are writes by the
   * current transaction; every other deletion remains visible but is not a
   * reason to reject a path-bounded delivery.
   */
  readonly commitFiles?: readonly string[];
}): ProtectedGovernanceStateReport {
  const commitFileSet = input.commitFiles
    ? new Set(input.commitFiles.map(normalizeRelativePath))
    : null;
  const deleted = new Set([
    ...listDiffNames(input.cwd, ['diff', '--cached', '--name-only', '--diff-filter=D'], input.env),
    ...listDiffNames(input.cwd, ['diff', '--name-only', '--diff-filter=D'], input.env)
  ]);
  const violations: ProtectedGovernanceStateViolation[] = [];
  for (const filePath of [...deleted].sort()) {
    if (commitFileSet && !commitFileSet.has(normalizeRelativePath(filePath))) continue;
    const classification = classifyProtectedGovernanceStatePath(filePath);
    if (!classification) continue;
    if (isEntitledGeneratedResidueDeletion(input.cwd, input.taskId, filePath)) continue;
    violations.push({
      path: filePath,
      pathClass: classification.pathClass,
      ownerTaskId: classification.ownerTaskId,
      operation: 'delete',
      recovery: `Restore the protected governance state path, then use the ATM lifecycle or reconcile command for ${classification.ownerTaskId ?? input.taskId}.`
    });
  }
  return {
    schemaId: 'atm.protectedGovernanceStateReport.v1',
    ok: violations.length === 0,
    code: violations.length > 0 ? ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE : null,
    summary: violations.length > 0
      ? `Protected governance state destructive write detected: ${violations.map((entry) => `${entry.pathClass}:${entry.path}`).join(', ')}.`
      : null,
    violations
  };
}

/**
 * Generated bundle-manifests are disposable close byproducts. A live writer
 * admitted for that exact history path may converge the deletion; every other
 * protected history deletion stays fail-closed.
 */
function isEntitledGeneratedResidueDeletion(cwd: string, writerWorkItemId: string, filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (!/^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/i.test(normalized)) return false;
  const isLiveTask = (taskId: string) => isLiveLedgerTask(cwd, taskId);
  return listEntitlementWriterIds(cwd, writerWorkItemId).some((candidateId) =>
    hasReconciliationEntitlement(cwd, {
      writerWorkItemId: candidateId,
      candidateFile: normalized,
      isLiveTask
    })
  );
}

/**
 * A live successor card may hold the residue in its own lock, or a linked
 * framework-temp claim may be the admitted writer. Entitlement still comes
 * from that writer's lock; this only enumerates who to ask.
 */
function listEntitlementWriterIds(cwd: string, writerWorkItemId: string): string[] {
  const ids = [writerWorkItemId];
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockRoot)) return ids;
  for (const name of readdirSync(lockRoot)) {
    if (!/^ATM-FRAMEWORK-TEMP-.*\.lock\.json$/i.test(name)) continue;
    try {
      const lock = JSON.parse(readFileSync(path.join(lockRoot, name), 'utf8')) as Record<string, unknown>;
      if (lock.released === true || lock.status === 'released') continue;
      const linked = typeof lock.linkedTaskId === 'string' ? lock.linkedTaskId.trim() : '';
      if (linked !== writerWorkItemId) continue;
      const workItemId = typeof lock.workItemId === 'string' && lock.workItemId.trim()
        ? lock.workItemId.trim()
        : name.replace(/\.lock\.json$/i, '');
      if (workItemId && !ids.includes(workItemId)) ids.push(workItemId);
    } catch {
      continue;
    }
  }
  return ids;
}

function isLiveLedgerTask(cwd: string, taskId: string): boolean {
  const ledgerPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(ledgerPath)) return false;
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>;
    const status = typeof ledger.status === 'string' ? ledger.status.trim().toLowerCase() : '';
    if (status === 'done' || status === 'abandoned' || status === 'blocked') return false;
    const claim = ledger.claim && typeof ledger.claim === 'object' && !Array.isArray(ledger.claim)
      ? ledger.claim as Record<string, unknown>
      : null;
    const claimState = typeof claim?.state === 'string' ? claim.state.trim().toLowerCase() : '';
    return status === 'running' || status === 'open' || claimState === 'active' || claimState === 'handoff';
  } catch {
    return false;
  }
}
