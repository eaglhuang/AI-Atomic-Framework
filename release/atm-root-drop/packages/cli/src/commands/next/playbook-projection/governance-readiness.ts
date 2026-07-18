// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildGovernanceReadinessHintContract } from '../governance-readiness.ts';
import { createFrameworkModeStatus } from '../../framework-development.ts';
import { isFrameworkMaintenancePrompt } from '../route-predicates.ts';
import { uniqueSorted } from '../view-projections.ts';
import { parseJsonText } from '../../shared.ts';
import { readStringArray } from '../intent-normalizers.ts';
import { buildActiveWorkSummary, normalizeWorkPath } from './active-work-summary.ts';

export function buildGovernanceReadinessHint(cwd: string, input: {
  readonly channel: GovernanceChannel | null;
  readonly prompt: string;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly ownFiles?: readonly string[];
  readonly frameworkClaimRequired?: boolean;
}) {
  return buildGovernanceReadinessHintContract({
    cwd,
    ...input,
    uniqueSorted,
    readTaskWorkFiles,
    buildActiveWorkSummary,
    createFrameworkModeStatus,
    isFrameworkMaintenancePrompt,
    isProtectedFrameworkBranchTarget
  });
}

function readTaskWorkFiles(cwd: string, taskId: string): string[] {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return [];
  try {
    const parsed = parseJsonText(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
      ? parsed.claim as Record<string, unknown>
      : {};
    const directionLock = parsed.taskDirectionLock && typeof parsed.taskDirectionLock === 'object' && !Array.isArray(parsed.taskDirectionLock)
      ? parsed.taskDirectionLock as Record<string, unknown>
      : {};
    return uniqueSorted([
      ...readStringArray(parsed.scope),
      ...readStringArray(parsed.scopePaths),
      ...readStringArray(parsed.files),
      ...readStringArray(parsed.deliverables),
      ...readStringArray(claimRecord.files),
      ...readStringArray(directionLock.allowedFiles)
    ].map(normalizeWorkPath).filter(Boolean));
  } catch {
    return [];
  }
}

export function shouldInspectCrossRepoFrameworkStatus(cwd: string, targetRepo: string | null) {
  if (!targetRepo) return false;
  const normalizedTarget = targetRepo.replace(/\\/g, '/').trim();
  if (!normalizedTarget) return false;
  const currentRoot = path.resolve(cwd);
  const currentName = path.basename(currentRoot).toLowerCase();
  if (normalizedTarget.toLowerCase() === currentName) return false;
  if (path.isAbsolute(normalizedTarget) && path.resolve(normalizedTarget) === currentRoot) return false;
  return true;
}

function isProtectedFrameworkBranchTarget(branch: string) {
  return branch === 'main'
    || branch === 'master'
    || branch === 'trunk'
    || /^release\/.+/.test(branch);
}
