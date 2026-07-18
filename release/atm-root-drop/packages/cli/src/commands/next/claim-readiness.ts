import { existsSync, readFileSync } from 'node:fs';
import { CliError } from '../shared.ts';
import { findTaskClaimDependencyBlockers, type TaskClaimDependencyBlocker } from '../tasks/public-surface.ts';
import { taskPathFor } from '../tasks/task-file-io-helpers.ts';
import { normalizeTaskRouteStatus } from './intent-normalizers.ts';
import { canTaskBePreparedForClaim } from './route-predicates.ts';
import { quoteCliValue } from './view-projections.ts';

// TASK-CID-0024: claim intent for next --claim.
// 'write' is the default mutating claim. 'closeout-only' (alias
// 'no-more-mutation') declares that the scoped deliverable already landed and
// the claim only needs governed closeout continuity, so parallel CID write
// conflicts are downgraded to advisory instead of blocking the claim.
export type NextClaimIntent = 'write' | 'closeout-only';

export interface ClaimReadinessTaskSummary {
  readonly workItemId: string;
  readonly status: string;
  readonly format: 'json' | 'markdown';
  readonly sourcePlanPath: string | null;
  readonly scopePaths?: readonly string[];
  readonly targetAllowedFiles?: readonly string[];
}

export interface ClaimReadinessDiagnostic {
  readonly taskId: string;
  readonly status: string;
  readonly format: 'json' | 'markdown';
  readonly claimable: boolean;
  readonly blockerCode: string;
  readonly blockerSummary: string;
  readonly requiredCommand: string | null;
  readonly dependencyBlockers: readonly TaskClaimDependencyBlocker[];
}

export interface ClaimReadinessReport {
  readonly schemaId: 'atm.claimReadinessReport.v1';
  readonly diagnostics: readonly ClaimReadinessDiagnostic[];
  readonly primaryBlocker: ClaimReadinessDiagnostic | null;
}

export function extractClaimIntentFlag(argv: readonly string[]): { argv: string[]; claimIntent: NextClaimIntent | null; autoIntent: boolean } {
  const remaining: string[] = [];
  let claimIntent: NextClaimIntent | null = null;
  let autoIntent = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--auto-intent') {
      autoIntent = true;
      continue;
    }
    if (arg === '--claim-intent') {
      const raw = String(argv[index + 1] ?? '').trim().toLowerCase();
      const normalized = raw === 'no-more-mutation' ? 'closeout-only' : raw;
      if (normalized !== 'write' && normalized !== 'closeout-only') {
        throw new CliError('ATM_CLI_USAGE', 'next --claim requires --claim-intent to be one of: write, closeout-only, no-more-mutation.', {
          exitCode: 2,
          details: { claimIntent: raw, allowedValues: ['write', 'closeout-only', 'no-more-mutation'] }
        });
      }
      claimIntent = normalized;
      autoIntent = false;
      index += 1;
      continue;
    }
    if (arg === '--closeout-only' || arg === '--no-more-mutation') {
      claimIntent = 'closeout-only';
      autoIntent = false;
      continue;
    }
    remaining.push(arg);
  }
  return { argv: remaining, claimIntent, autoIntent };
}

export function diagnoseClaimReadinessForTasks(
  cwd: string,
  tasks: readonly ClaimReadinessTaskSummary[],
  claimIntent: NextClaimIntent
): ClaimReadinessReport {
  const diagnostics: ClaimReadinessDiagnostic[] = [];
  for (const task of tasks) {
    const status = normalizeTaskRouteStatus(task.status);
    const claimable = canTaskBePreparedForClaim(status) || (status === 'review' && claimIntent === 'closeout-only');
    if (task.format === 'markdown') {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED',
        blockerSummary: `Task ${task.workItemId} is still a Markdown task card and must be imported before claim.`,
        requiredCommand: task.sourcePlanPath
          ? `node atm.mjs tasks import --from ${quoteCliValue(task.sourcePlanPath)} --dry-run --cwd . --json`
          : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json',
        dependencyBlockers: []
      });
      continue;
    }
    if (status === 'review' && claimIntent !== 'closeout-only') {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED',
        blockerSummary: `Task ${task.workItemId} is in review; reclaim it only through closeout-only when no more source mutation is needed.`,
        requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(task.workItemId)} --claim-intent closeout-only --json`,
        dependencyBlockers: []
      });
      continue;
    }
    const taskPath = taskPathFor(cwd, task.workItemId);
    const dependencyBlockers = existsSync(taskPath)
      ? (() => {
        try {
          const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
          return findTaskClaimDependencyBlockers(cwd, task.workItemId, taskDocument, {
            claimFiles: task.targetAllowedFiles ?? task.scopePaths ?? []
          });
        } catch {
          return [];
        }
      })()
      : [];
    if (dependencyBlockers.length > 0) {
      const firstBlocker = dependencyBlockers[0];
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED',
        blockerSummary: firstBlocker.status === 'source-done-governance-incomplete'
          ? `Task ${task.workItemId} is blocked because prerequisite ${firstBlocker.taskId} is source-done but not governably closed.`
          : `Task ${task.workItemId} is blocked until prerequisite task(s) close.`,
        requiredCommand: firstBlocker.requiredCommand
          ?? (firstBlocker.status === 'incomplete-closeout' || firstBlocker.status === 'source-done-governance-incomplete'
            ? `node atm.mjs tasks status --task ${firstBlocker.taskId} --residue --json`
            : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`),
        dependencyBlockers
      });
      continue;
    }
    if (!claimable) {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_NOT_READY',
        blockerSummary: `Task ${task.workItemId} is currently ${status} and cannot be claimed yet.`,
        requiredCommand: `node atm.mjs tasks status --task ${task.workItemId} --json`,
        dependencyBlockers: []
      });
      continue;
    }
    diagnostics.push({
      taskId: task.workItemId,
      status,
      format: task.format,
      claimable: true,
      blockerCode: 'ATM_NEXT_CLAIM_READY',
      blockerSummary: `Task ${task.workItemId} can be prepared for claim.`,
      requiredCommand: `node atm.mjs next --claim --actor <id> --task ${task.workItemId} --auto-intent --json`,
      dependencyBlockers: []
    });
  }
  const primaryBlocker = diagnostics.find((entry) => !entry.claimable) ?? null;
  return {
    schemaId: 'atm.claimReadinessReport.v1',
    diagnostics,
    primaryBlocker
  };
}
