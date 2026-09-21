import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isExternalPlanningStoredPath, normalizeStoredPlanningPathForIdentity, resolveStoredPlanningPath } from '../planning-repo-root.ts';
import { isPathAllowedByScope } from '../work-channels.ts';
import type { TaskDirectionTask, TaskScopePartition } from '../task-direction.ts';
import {
  derivePlanningMirrorGuardPaths,
  isExternalPlanningPath,
  isPlanningMirrorPath,
  isTaskDirectionLock,
  normalizeRelativePath,
  sanitizeTaskDirectionAllowedFiles,
  uniqueSorted
} from './support.ts';

export interface TaskDirectionAllowedFilesDiagnosis {
  readonly taskId: string;
  readonly hasGovernanceLock: boolean;
  readonly canonicalAllowedFiles: readonly string[] | null;
  readonly governanceLockFiles: readonly string[] | null;
  readonly claimFiles: readonly string[] | null;
  readonly mismatches: readonly TaskDirectionAllowedFilesMismatch[];
}

export interface TaskDirectionAllowedFilesMismatch {
  readonly source: 'governance-lock-files' | 'claim-files';
  readonly missingFromSource: readonly string[];
  readonly extraInSource: readonly string[];
}

export function getCanonicalAllowedFilesForTask(cwd: string, taskId: string): readonly string[] | null {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (existsSync(lockPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const released = parsed.released === true || parsed.status === 'released';
      if (!released && isTaskDirectionLock(parsed.taskDirectionLock)) return parsed.taskDirectionLock.allowedFiles;
    } catch { /* Fall through to sidecar. */ }
  }
  const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
  if (existsSync(sidecarPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      if (isTaskDirectionLock(parsed)) return parsed.allowedFiles;
    } catch { /* Ignore malformed runtime files. */ }
  }
  return null;
}

export function diagnoseTaskDirectionLockAllowedFiles(cwd: string, taskId: string): TaskDirectionAllowedFilesDiagnosis {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  let canonicalAllowedFiles: readonly string[] | null = null;
  let governanceLockFiles: readonly string[] | null = null;
  let hasGovernanceLock = false;
  if (existsSync(lockPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      if (parsed.released !== true && parsed.status !== 'released') {
        hasGovernanceLock = true;
        if (isTaskDirectionLock(parsed.taskDirectionLock)) canonicalAllowedFiles = parsed.taskDirectionLock.allowedFiles;
        if (Array.isArray(parsed.files)) governanceLockFiles = uniqueSorted(parsed.files.filter((entry): entry is string => typeof entry === 'string').map(normalizeRelativePath));
      }
    } catch { /* Ignore malformed runtime files. */ }
  }
  if (!canonicalAllowedFiles) canonicalAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId);
  let claimFiles: readonly string[] | null = null;
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (existsSync(taskPath)) {
    try {
      const claim = (JSON.parse(readFileSync(taskPath, 'utf8')) as { claim?: { files?: unknown[] } }).claim;
      if (Array.isArray(claim?.files)) claimFiles = uniqueSorted(claim.files.filter((entry): entry is string => typeof entry === 'string').map(normalizeRelativePath));
    } catch { /* Ignore malformed ledger files. */ }
  }
  const mismatches: TaskDirectionAllowedFilesMismatch[] = [];
  for (const [source, files] of [['governance-lock-files', governanceLockFiles], ['claim-files', claimFiles]] as const) {
    if (!canonicalAllowedFiles || !files) continue;
    const drift = computeAllowedFilesDrift(canonicalAllowedFiles, files);
    if (drift.missingFromSource.length || drift.extraInSource.length) mismatches.push({ source, ...drift });
  }
  return { taskId, hasGovernanceLock, canonicalAllowedFiles, governanceLockFiles, claimFiles, mismatches };
}

function computeAllowedFilesDrift(canonical: readonly string[], source: readonly string[]) {
  const canonicalSet = new Set(canonical.map((value) => normalizeRelativePath(value).toLowerCase()));
  const sourceSet = new Set(source.map((value) => normalizeRelativePath(value).toLowerCase()));
  return {
    missingFromSource: [...canonicalSet].filter((value) => !sourceSet.has(value)).sort(),
    extraInSource: [...sourceSet].filter((value) => !canonicalSet.has(value)).sort()
  };
}

export function buildAllowedFilesForTask(task: TaskDirectionTask): readonly string[] {
  return partitionTaskScope(task).targetWork.allowedFiles;
}

export function buildTaskSelfAllowPaths(taskId: string): readonly string[] {
  return [`.atm/history/tasks/${taskId}.json`, `.atm/history/evidence/${taskId}.*`, `.atm/history/task-events/${taskId}/**`];
}

export function partitionTaskScope(task: TaskDirectionTask, options?: { readonly cwd?: string }): TaskScopePartition {
  const cwd = options?.cwd ?? null;
  const normalizeScopePath = (value: string) => !value ? value : cwd ? normalizeStoredPlanningPathForIdentity(cwd, value) : normalizeRelativePath(value);
  const isPlanningPath = (value: string) => value ? (cwd ? isExternalPlanningStoredPath(cwd, value) : isExternalPlanningPath(value)) : false;
  const resolveAbsolute = (value: string) => !value ? '' : cwd ? resolveStoredPlanningPath(cwd, value).absolutePath : path.resolve(value);
  // Planning context may live outside the target repository.  These paths are
  // read-only guard inputs, not target-work write grants, so preserving their
  // resolved absolute form is required to derive a local mirror guard.
  const planningReadOnlyPaths = uniqueSorted([
    task.sourcePlanPath ?? '', ...task.nearbyPlanPaths, ...task.scopePaths.filter(isPlanningPath)
  ].map(resolveAbsolute).filter(Boolean));
  const planningMirrorPaths = uniqueSorted(planningReadOnlyPaths.flatMap(derivePlanningMirrorGuardPaths));
  const targetCandidates = sanitizeTaskDirectionAllowedFiles(task.scopePaths.map(normalizeScopePath));
  const allowedFiles = targetCandidates.filter((entry) => !planningReadOnlyPaths.includes(entry)
    && (task.allowPlanningMirror || !isPlanningMirrorPath(entry, planningMirrorPaths))
    && !(task.outOfScope && isPathAllowedByScope(entry, task.outOfScope)));
  if (task.outOfScope?.length) {
    const intersections = targetCandidates.filter((entry) => isPathAllowedByScope(entry, task.outOfScope!));
    if (intersections.length) console.warn(`[ATM-WARNING] Task ${task.workItemId} scope paths intersect with outOfScope: ${intersections.join(', ')}. These files are subtracted from targetAllowedFiles.`);
  }
  return { planningContext: { readOnlyPaths: planningReadOnlyPaths }, targetWork: { allowedFiles, planningMirrorPaths, allowPlanningMirror: task.allowPlanningMirror } };
}
