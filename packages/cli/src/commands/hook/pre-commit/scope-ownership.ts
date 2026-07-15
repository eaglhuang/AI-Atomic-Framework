import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { readBrokerLifecycleState } from '../../../../../core/src/broker/lifecycle.ts';
import { inspectTrackedActorRegistryState } from '../../actor-registry.ts';
import { readActiveCloseCommitWindows } from '../../framework-development.ts';
import { listTaskOwnedProtectedOverrideAuditFiles } from '../../git-governance.ts';
import { quoteCliValue, relativePathFrom } from '../../shared.ts';
import { isPlanningMirrorPath, isTaskDirectionPathCandidate, readActiveTaskDirectionLocks } from '../../task-direction.ts';
import { taskIdsEqual, taskIdsInclude } from '../../tasks/task-import-validators.ts';
import { normalizeOptionalText, readJsonText } from '../commit-range-guard.ts';
import { normalizeRelativePath } from '../git-index-diagnostics.ts';

interface SameFileClaimOwnershipFinding {
  readonly code: 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' | 'ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION';
  readonly file: string;
  readonly committingTaskId: string | null;
  readonly writeClaimTaskIds: readonly string[];
  readonly detail: string;
  readonly requiredCommand: string | null;
}

interface SameFileClaimOwnershipReport {
  readonly ok: boolean;
  readonly committingTaskId: string | null;
  readonly committingClaimIntent: string | null;
  readonly multiClaimFiles: readonly { readonly file: string; readonly writeClaimTaskIds: readonly string[] }[];
  readonly stewardCoveredFiles: readonly string[];
  readonly findings: readonly SameFileClaimOwnershipFinding[];
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return readJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function inferTaskIdsFromStagedFiles(stagedFiles: readonly string[]) {
  const taskIds = new Set<string>();
  for (const file of stagedFiles) {
    const normalized = normalizeRelativePath(file);
    const taskMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
    if (taskMatch) {
      taskIds.add(taskMatch[1]);
      continue;
    }
    const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/]+)\.(?:json|closure-packet\.json|bundle-manifest\.json)$/i);
    if (evidenceMatch) {
      taskIds.add(evidenceMatch[1]);
      continue;
    }
    const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
    if (eventMatch) {
      taskIds.add(eventMatch[1]);
    }
  }
  return [...taskIds].sort((left, right) => left.localeCompare(right));
}

// TASK-CID-0024: decide staged ownership when multiple active claims may cover
// the same file. Multiple same-file claims alone never block; a finding is
// produced only when:
//   1. the staged file is covered by active write claims that do NOT include
//      the committing task (mixed staged content) and no steward/broker
//      evidence covers the file, or
//   2. the committing task claimed closeout-only / no-more-mutation but stages
//      real source mutations anyway (the intent is non-mutating by contract).
export function inspectSameFileClaimOwnership(input: {
  readonly cwd: string;
  readonly stagedFiles: readonly string[];
  readonly activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
  readonly exemptAllowedFileSets: readonly (readonly string[])[];
}): SameFileClaimOwnershipReport {
  const inferredTaskIds = inferTaskIdsFromStagedFiles(input.stagedFiles);
  const committingTaskId = normalizeOptionalText(process.env.ATM_COMMIT_TASK_ID)
    ?? (inferredTaskIds.length === 1 ? inferredTaskIds[0] : null);
  const claimIntentByTaskId = new Map<string, string>();
  const readClaimIntent = (taskId: string): string => {
    const cached = claimIntentByTaskId.get(taskId);
    if (cached) return cached;
    const taskDocument = readJsonFile(path.join(input.cwd, '.atm', 'history', 'tasks', `${taskId}.json`));
    const claim = taskDocument?.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
      ? taskDocument.claim as Record<string, unknown>
      : null;
    const intent = normalizeOptionalText(claim?.intent) ?? 'write';
    claimIntentByTaskId.set(taskId, intent);
    return intent;
  };
  const writeLocks = input.activeDirectionLocks.filter((lock) => readClaimIntent(lock.taskId) !== 'closeout-only');
  const committingClaimIntent = committingTaskId ? readClaimIntent(committingTaskId) : null;
  const stewardCoveredFiles = collectStewardBrokerCoveredFiles(input.cwd);
  const stewardCoveredSet = new Set(stewardCoveredFiles.map((entry) => normalizeRelativePath(entry).toLowerCase()));
  const findings: SameFileClaimOwnershipFinding[] = [];
  const multiClaimFiles: { file: string; writeClaimTaskIds: readonly string[] }[] = [];
  for (const stagedFile of input.stagedFiles) {
    const normalized = normalizeRelativePath(stagedFile);
    if (!normalized || normalized.startsWith('.atm/')) continue;
    if (isTaskDirectionPreCommitExempt(normalized)) continue;
    if (input.exemptAllowedFileSets.some((allowed) => allowed.length > 0 && isPathAllowedByTaskDirection(normalized, allowed))) continue;
    const coveringWriteLocks = writeLocks.filter((lock) => isPathAllowedByTaskDirection(normalized, lock.allowedFiles));
    if (coveringWriteLocks.length === 0) {
      // No active write claim covers this file; direction-lock drift owns it.
      // Still enforce the closeout-only non-mutation contract for the
      // committing task itself.
      if (committingClaimIntent === 'closeout-only'
        && input.activeDirectionLocks.some((lock) => lock.taskId === committingTaskId && isPathAllowedByTaskDirection(normalized, lock.allowedFiles))) {
        findings.push({
          code: 'ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION',
          file: normalized,
          committingTaskId,
          writeClaimTaskIds: [],
          detail: `Task ${committingTaskId} holds a closeout-only / no-more-mutation claim but stages source mutation ${normalized}. Re-claim with a write intent before shipping new source changes.`,
          requiredCommand: committingTaskId
            ? `node atm.mjs next --claim --actor <id> --task ${committingTaskId} --claim-intent write --json`
            : null
        });
      }
      continue;
    }
    const writeClaimTaskIds = uniqueSorted(coveringWriteLocks.map((lock) => lock.taskId));
    if (writeClaimTaskIds.length > 1) {
      multiClaimFiles.push({ file: normalized, writeClaimTaskIds });
    }
    const committingOwnsFile = Boolean(committingTaskId) && writeClaimTaskIds.includes(committingTaskId as string);
    if (committingOwnsFile) continue;
    const ambiguous = committingTaskId ? writeClaimTaskIds.length >= 1 : writeClaimTaskIds.length >= 2;
    if (!ambiguous) continue;
    if (stewardCoveredSet.has(normalized.toLowerCase())) continue;
    findings.push({
      code: 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS',
      file: normalized,
      committingTaskId,
      writeClaimTaskIds,
      detail: committingTaskId
        ? `Staged file ${normalized} belongs to active write claim(s) ${writeClaimTaskIds.join(', ')} but the committing task ${committingTaskId} does not own it, and no steward/broker evidence covers it. Remove it from this commit or route it through the steward lane.`
        : `Staged file ${normalized} is covered by multiple active write claims (${writeClaimTaskIds.join(', ')}) and ATM cannot prove which task owns this commit. Commit through node atm.mjs git commit --task <id> or provide steward/broker evidence.`,
      requiredCommand: 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --json'
    });
  }
  return {
    ok: findings.length === 0,
    committingTaskId,
    committingClaimIntent,
    multiClaimFiles,
    stewardCoveredFiles,
    findings
  };
}

export function selectRelevantDirectionLocksForCommit(input: {
  readonly activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
  readonly stagedFiles: readonly string[];
  readonly committingTaskId: string | null;
  readonly taskGovernedCommitAllowedFiles: readonly string[];
  readonly closeCommitWindowAllowedFiles: readonly string[];
  readonly closeCommitWindowPlanningMirrorFiles: readonly string[];
}): ReturnType<typeof readActiveTaskDirectionLocks> {
  const currentTaskAllowedFiles = uniqueSorted([
    ...input.taskGovernedCommitAllowedFiles,
    ...input.closeCommitWindowAllowedFiles,
    ...input.closeCommitWindowPlanningMirrorFiles
  ]);
  return input.activeDirectionLocks.filter((lock) => {
    if (input.committingTaskId && taskIdsEqual(lock.taskId, input.committingTaskId)) {
      return true;
    }
    return input.stagedFiles.some((entry) => {
      if (isTaskDirectionPreCommitExempt(entry)) return false;
      if (currentTaskAllowedFiles.length > 0 && isPathAllowedByTaskDirection(entry, currentTaskAllowedFiles)) {
        return false;
      }
      return isPathAllowedByTaskDirection(entry, lock.allowedFiles)
        || isPlanningMirrorPath(entry, lock.planningMirrorPaths ?? []);
    });
  });
}

// TASK-CID-0024: files currently covered by an active steward/composer broker
// intent count as steward/broker evidence for staged ownership decisions.
function collectStewardBrokerCoveredFiles(cwd: string): readonly string[] {
  try {
    const state = readBrokerLifecycleState(cwd);
    return uniqueSorted(state.activeIntents
      .filter((intent) => intent.lane === 'neutral-steward' || intent.lane === 'deterministic-composer')
      .flatMap((intent) => intent.resourceKeys?.files ?? [])
      .map((entry) => normalizeRelativePath(entry))
      .filter(Boolean));
  } catch {
    return [];
  }
}

export function isTaskDirectionPreCommitExempt(value: string): boolean {
  const normalized = normalizeRelativePath(value).toLowerCase();
  return normalized.startsWith('.atm/history/task-events/')
    || normalized.startsWith('.atm/history/evidence/')
    || normalized.startsWith('.atm/runtime/locks/')
    || normalized.startsWith('.atm/runtime/task-queues/')
    || normalized.startsWith('.atm/runtime/batch-runs/')
    || normalized.startsWith('.atm/runtime/task-direction-locks/');
}

export function collectStagedBatchCheckpointScopeFiles(cwd: string, stagedFiles: readonly string[]): readonly string[] {
  const stagedSet = new Set(stagedFiles.map((entry) => normalizeRelativePath(entry)));
  const allowedFiles: string[] = [];
  for (const file of stagedFiles) {
    const normalized = normalizeRelativePath(file);
    const lower = normalized.toLowerCase();
    if (!lower.startsWith('.atm/history/tasks/') || !lower.endsWith('.json')) {
      continue;
    }
    const task = readJsonFile(path.join(cwd, normalized));
    if (task?.status !== 'done') continue;
    const taskId = typeof task.workItemId === 'string' ? task.workItemId : path.basename(normalized, '.json');
    const lastTransitionId = typeof task.lastTransitionId === 'string' ? task.lastTransitionId : '';
    const expectedEventPath = `.atm/history/task-events/${taskId}/${lastTransitionId}.json`;
    if (!lastTransitionId || !stagedSet.has(expectedEventPath)) {
      continue;
    }
    const event = readJsonFile(path.join(cwd, expectedEventPath));
    const closure = event?.closure as { schemaId?: unknown } | undefined;
    if (typeof event?.command !== 'string'
      || !event.command.startsWith('node atm.mjs tasks close')
      || (!event.command.includes('--from-batch-checkpoint') && closure?.schemaId !== 'atm.taskClosureTransition.v1')) {
      continue;
    }
    allowedFiles.push(normalized);
    allowedFiles.push(...extractCheckpointTaskScopeFiles(task));
  }
  return uniqueSorted(allowedFiles);
}

export function collectFrameworkTempClaimAllowedFiles(cwd: string): readonly string[] {
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockRoot)) return [];
  const allowedFiles: string[] = [];
  for (const entry of readdirSync(lockRoot).filter((fileName) => fileName.startsWith('ATM-FRAMEWORK-TEMP-') && fileName.endsWith('.lock.json'))) {
    const lock = readJsonFile(path.join(lockRoot, entry));
    collectStringArrayField(lock?.files, allowedFiles);
  }
  return uniqueSorted(allowedFiles.map(normalizeRelativePath).filter(isTaskDirectionPathCandidate));
}

export function collectCloseCommitWindowPlanningMirrorFiles(cwd: string): readonly string[] {
  const files: string[] = [];
  for (const win of readActiveCloseCommitWindows(cwd)) {
    const task = readJsonFile(path.join(cwd, '.atm', 'history', 'tasks', `${win.taskId}.json`));
    if (!task || typeof task !== 'object') continue;
    const source = isPlainObject(task.source) ? task.source : null;
    const planPath = typeof source?.planPath === 'string' ? normalizeRelativePath(source.planPath) : '';
    if (planPath) files.push(planPath);
    collectStringArrayField((task as Record<string, unknown>).planningMirrorPaths, files);
  }
  return uniqueSorted(files.map(normalizeRelativePath).filter(isTaskDirectionPathCandidate));
}

export function collectTaskGovernedCommitAllowedFiles(cwd: string, taskId: string | null): readonly string[] {
  if (!taskId) return [];
  const files = [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.bundle-manifest.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`,
    `.atm/history/task-events/${taskId}/**`
  ];
  const task = readJsonFile(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`));
  if (task && typeof task === 'object') {
    const source = isPlainObject(task.source) ? task.source : null;
    const planPath = typeof source?.planPath === 'string' ? normalizeRelativePath(source.planPath) : '';
    if (planPath) files.push(planPath);
    collectStringArrayField((task as Record<string, unknown>).planningMirrorPaths, files);
  }
  const actorRegistryState = inspectTrackedActorRegistryState(cwd);
  if (actorRegistryState.tracked && (actorRegistryState.staged || actorRegistryState.unstaged)) {
    files.push(actorRegistryState.path);
  }
  files.push(...listTaskOwnedProtectedOverrideAuditFiles(cwd, taskId));
  return uniqueSorted(files.map(normalizeRelativePath).filter(isTaskDirectionPathCandidate));
}

function extractCheckpointTaskScopeFiles(task: Record<string, unknown>): readonly string[] {
  const candidates: string[] = [];
  collectStringArrayField(task.scope, candidates);
  collectStringArrayField(task.scopePaths, candidates);
  collectStringArrayField(task.deliverables, candidates);
  collectStringArrayField(task.files, candidates);
  collectStringArrayField(task.allowedFiles, candidates);
  const targetWork = isPlainObject(task.targetWork) ? task.targetWork : null;
  if (targetWork) {
    collectStringArrayField(targetWork.allowedFiles, candidates);
    collectStringArrayField(targetWork.files, candidates);
  }
  return uniqueSorted(candidates
    .map(normalizeRelativePath)
    .filter(isTaskDirectionPathCandidate));
}

function collectStringArrayField(value: unknown, output: string[]) {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === 'string') output.push(entry);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathAllowedByTaskDirection(filePath: string, allowedFiles: readonly string[]): boolean {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  const cwd = process.cwd();
  return allowedFiles.some((candidate) => {
    let relCandidate = candidate;
    if (path.isAbsolute(candidate)) {
      relCandidate = relativePathFrom(cwd, candidate);
    }
    return matchesTaskDirectionPath(normalizedFile, normalizeRelativePath(relCandidate).toLowerCase());
  });
}

function matchesTaskDirectionPath(filePath: string, allowedPath: string): boolean {
  if (!allowedPath) return false;
  if (allowedPath.includes('*')) {
    const pattern = allowedPath
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE_STAR::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${pattern}$`, 'i').test(filePath);
  }
  if (filePath === allowedPath) return true;
  if (allowedPath.endsWith('/')) return filePath.startsWith(allowedPath);
  const allowedPathHasExtension = /\.[a-z0-9]+$/i.test(allowedPath);
  return !allowedPathHasExtension && filePath.startsWith(`${allowedPath}/`);
}
