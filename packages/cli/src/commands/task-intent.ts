import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detectFrameworkRepoIdentity } from './framework-development.ts';

export type TaskDeliveryIntent =
  | 'framework-delivery'      // Current cwd is the target framework repo; deliver here.
  | 'mirror-sync-only'        // Task delivery lives elsewhere (planning_repo authority + different repo). Only the ledger mirror needs syncing here.
  | 'cross-repo-delivery'     // Closure authority is target_repo but target is a different repo from current cwd.
  | 'unknown';

export interface TaskDeliveryClassification {
  readonly intent: TaskDeliveryIntent;
  readonly reason: string;
  readonly targetRepo: string | null;
  readonly closureAuthority: string | null;
  readonly planningRepo: string | null;
  readonly ledgerStatus: string | null;
  readonly sourceStatus: string | null;
  readonly statusDivergence: boolean;
  readonly recommendedActions: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface ClassifyTaskDeliveryInput {
  readonly cwd: string;
  readonly task: {
    readonly workItemId: string;
    readonly status: string;
    readonly targetRepo: string | null;
    readonly closureAuthority: string | null;
    readonly planningRepo?: string | null;
    readonly sourcePlanPath: string | null;
    readonly taskPath: string;
  };
}

/**
 * Classify how a task should be delivered from the current cwd, based on
 * machine fields preserved by `tasks import` (target_repo, closure_authority,
 * planning_repo) and the canonical source task-card status.
 *
 * This is used by `next` to avoid suggesting a delivery playbook when the task
 * actually lives in a different repo or already shipped upstream.
 */
export function classifyTaskDelivery(input: ClassifyTaskDeliveryInput): TaskDeliveryClassification {
  const { cwd, task } = input;
  const closureAuthority = task.closureAuthority ? task.closureAuthority.trim() : null;
  const targetRepo = task.targetRepo ? task.targetRepo.trim() : null;
  const planningRepo = task.planningRepo ? task.planningRepo.trim() : null;
  const ledgerStatus = task.status ? task.status.trim() : null;
  const sourceStatus = task.sourcePlanPath ? readSourceTaskCardStatus(cwd, task.sourcePlanPath, task.workItemId) : null;
  const statusDivergence = Boolean(sourceStatus && ledgerStatus && sourceStatus.toLowerCase() !== ledgerStatus.toLowerCase());

  const targetIsCurrentRepo = targetRepo ? matchesCurrentRepoIdentityLite(cwd, targetRepo) : true;
  const diagnostics: string[] = [];
  if (statusDivergence) {
    diagnostics.push(`ledger-mirror-stale:${ledgerStatus ?? 'unknown'}->source:${sourceStatus ?? 'unknown'}`);
  }
  if (closureAuthority) diagnostics.push(`closure-authority:${closureAuthority}`);
  if (targetRepo) diagnostics.push(`target-repo:${targetRepo}`);
  if (planningRepo) diagnostics.push(`planning-repo:${planningRepo}`);

  if (closureAuthority === 'planning_repo' && !targetIsCurrentRepo) {
    const sourcePath = task.sourcePlanPath ?? '<source-task-card-path>';
    const recommendedActions: string[] = [];
    if (statusDivergence || (sourceStatus ?? '').toLowerCase() === 'done') {
      recommendedActions.push(
        `node atm.mjs tasks import --from ${quoteIfNeeded(sourcePath)} --write --force --json`
      );
      recommendedActions.push(
        'Inspect the refreshed ledger mirror to confirm the source-card status (e.g. `done`) is preserved.'
      );
    } else {
      recommendedActions.push(
        `Do not implement deliverables for ${task.workItemId} from this repo; the task is owned by ${targetRepo ?? planningRepo ?? 'a different repo'} via planning_repo authority.`
      );
      recommendedActions.push(
        `node atm.mjs tasks import --from ${quoteIfNeeded(sourcePath)} --dry-run --json`
      );
    }
    return {
      intent: 'mirror-sync-only',
      reason: statusDivergence
        ? `Task ${task.workItemId} closure authority is planning_repo and target_repo (${targetRepo ?? 'n/a'}) differs from the current framework repo; the ledger mirror here is stale relative to the source task card.`
        : `Task ${task.workItemId} closure authority is planning_repo and target_repo (${targetRepo ?? 'n/a'}) differs from the current framework repo; deliverables belong to the planning repo, not this one.`,
      targetRepo,
      closureAuthority,
      planningRepo,
      ledgerStatus,
      sourceStatus,
      statusDivergence,
      recommendedActions,
      diagnostics
    };
  }

  if (closureAuthority === 'target_repo' && targetRepo && !targetIsCurrentRepo) {
    return {
      intent: 'cross-repo-delivery',
      reason: `Task ${task.workItemId} closure authority is target_repo and target_repo (${targetRepo}) is not the current framework repo; switch cwd to the target repo before delivery.`,
      targetRepo,
      closureAuthority,
      planningRepo,
      ledgerStatus,
      sourceStatus,
      statusDivergence,
      recommendedActions: [
        `Change cwd to ${targetRepo} (or the local checkout path) before running next --claim.`,
        `node atm.mjs framework-mode status --json`
      ],
      diagnostics
    };
  }

  if (closureAuthority === 'planning_repo' && targetIsCurrentRepo) {
    return {
      intent: 'framework-delivery',
      reason: `Task ${task.workItemId} declares planning_repo authority but target_repo (${targetRepo ?? 'n/a'}) is the current repo; treat as framework delivery.`,
      targetRepo,
      closureAuthority,
      planningRepo,
      ledgerStatus,
      sourceStatus,
      statusDivergence,
      recommendedActions: [],
      diagnostics
    };
  }

  if (!closureAuthority && targetRepo && !targetIsCurrentRepo) {
    return {
      intent: 'cross-repo-delivery',
      reason: `Task ${task.workItemId} target_repo (${targetRepo}) is not the current framework repo and closure authority is unspecified; treat as cross-repo delivery.`,
      targetRepo,
      closureAuthority: null,
      planningRepo,
      ledgerStatus,
      sourceStatus,
      statusDivergence,
      recommendedActions: [
        `Change cwd to ${targetRepo} before running next --claim, or add closure_authority to the task card.`
      ],
      diagnostics
    };
  }

  return {
    intent: 'framework-delivery',
    reason: closureAuthority
      ? `Task ${task.workItemId} closure authority ${closureAuthority} resolves to current framework repo.`
      : `Task ${task.workItemId} has no cross-repo signals; treat as framework delivery in current cwd.`,
    targetRepo,
    closureAuthority,
    planningRepo,
    ledgerStatus,
    sourceStatus,
    statusDivergence,
    recommendedActions: [],
    diagnostics
  };
}

function readSourceTaskCardStatus(cwd: string, sourcePlanPath: string, workItemId: string): string | null {
  const absolute = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(absolute)) return null;
  try {
    const text = readFileSync(absolute, 'utf8');
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!match) return null;
    const block = match[1];
    let blockTaskId: string | null = null;
    let blockStatus: string | null = null;
    for (const rawLine of block.split(/\r?\n/)) {
      const taskIdMatch = /^task_id\s*:\s*(.+)$/.exec(rawLine);
      if (taskIdMatch) blockTaskId = taskIdMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const statusMatch = /^status\s*:\s*(.+)$/.exec(rawLine);
      if (statusMatch) blockStatus = statusMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
    if (blockTaskId && blockTaskId.toUpperCase() !== workItemId.toUpperCase()) return null;
    return blockStatus;
  } catch {
    return null;
  }
}

function matchesCurrentRepoIdentityLite(cwd: string, targetRepo: string): boolean {
  const identity = detectFrameworkRepoIdentity(cwd);
  const target = targetRepo.trim().toLowerCase().replace(/\\/g, '/');
  const rootNormalized = cwd.replace(/\\/g, '/').toLowerCase();
  const basename = path.basename(cwd).toLowerCase();
  return target === rootNormalized
    || target === (identity.name ? identity.name.toLowerCase() : '')
    || target === basename
    || target.endsWith(`/${basename}`);
}

function quoteIfNeeded(value: string): string {
  if (!value) return '""';
  if (/[\s"'`$]/.test(value)) return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
  return value;
}
