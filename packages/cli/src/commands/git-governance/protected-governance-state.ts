import { execFileSync } from 'node:child_process';

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

function listDiffNames(cwd: string, args: readonly string[]): string[] {
  try {
    return execFileSync('git', [...args, '-z'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).split('\0').map(normalizeRelativePath).filter(Boolean);
  } catch {
    return [];
  }
}

export function inspectProtectedGovernanceStateDestructiveChanges(input: {
  readonly cwd: string;
  readonly taskId: string;
}): ProtectedGovernanceStateReport {
  const deleted = new Set([
    ...listDiffNames(input.cwd, ['diff', '--cached', '--name-only', '--diff-filter=D']),
    ...listDiffNames(input.cwd, ['diff', '--name-only', '--diff-filter=D'])
  ]);
  const violations: ProtectedGovernanceStateViolation[] = [];
  for (const filePath of [...deleted].sort()) {
    const classification = classifyProtectedGovernanceStatePath(filePath);
    if (!classification) continue;
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
