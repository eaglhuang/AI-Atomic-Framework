import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from './shared.ts';

export interface TaskDirectionTask {
  readonly workItemId: string;
  readonly title: string;
  readonly taskPath: string;
  readonly sourcePlanPath: string | null;
  readonly nearbyPlanPaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly targetRepo: string | null;
  readonly allowPlanningMirror: boolean;
}

export interface TaskScopePartition {
  readonly planningContext: {
    readonly readOnlyPaths: readonly string[];
  };
  readonly targetWork: {
    readonly allowedFiles: readonly string[];
    readonly planningMirrorPaths: readonly string[];
    readonly allowPlanningMirror: boolean;
  };
}

export interface TaskQueueRecord {
  readonly schemaId: 'atm.taskQueue.v1';
  readonly specVersion: '0.1.0';
  readonly queueId: string;
  readonly batchId: string | null;
  readonly scopeKey: string | null;
  readonly sourcePrompt: string;
  readonly sourcePromptHash: string;
  readonly sourcePlanPath: string | null;
  readonly targetRepo: string | null;
  readonly taskIds: readonly string[];
  readonly tasks: readonly TaskDirectionTask[];
  readonly currentIndex: number;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly createdByActor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly abandonedByActor?: string;
  readonly abandonedAt?: string;
  readonly abandonReason?: string;
}

export interface TaskDirectionLock {
  readonly schemaId: 'atm.taskDirectionLock.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly batchId: string | null;
  readonly scopeKey: string | null;
  readonly queueId: string | null;
  readonly queueIndex: number | null;
  readonly allowedFiles: readonly string[];
  readonly planningReadOnlyPaths: readonly string[];
  readonly planningMirrorPaths: readonly string[];
  readonly allowPlanningMirror: boolean;
  readonly promptHash: string | null;
  readonly actorId: string;
  readonly createdAt: string;
  readonly status: 'active';
}

export function createOrRefreshTaskQueue(input: {
  readonly cwd: string;
  readonly sourcePrompt: string;
  readonly tasks: readonly TaskDirectionTask[];
  readonly actorId?: string | null;
  readonly batchId?: string | null;
  readonly scopeKey?: string | null;
  readonly taskIds?: readonly string[] | null;
}): TaskQueueRecord {
  const sourcePrompt = input.sourcePrompt.trim();
  const taskIds = input.taskIds && input.taskIds.length > 0
    ? uniqueInOrder(input.taskIds)
    : uniqueInOrder(input.tasks.map((task) => task.workItemId));
  const queueId = buildQueueId(sourcePrompt, taskIds);
  const now = new Date().toISOString();
  const existing = readTaskQueue(input.cwd, queueId);
  const activeExisting = existing?.status === 'active' ? existing : null;
  const currentIndex = activeExisting
    ? Math.min(activeExisting.currentIndex, Math.max(0, taskIds.length - 1))
    : 0;
  const record: TaskQueueRecord = {
    schemaId: 'atm.taskQueue.v1',
    specVersion: '0.1.0',
    queueId,
    batchId: activeExisting?.batchId ?? input.batchId ?? null,
    scopeKey: activeExisting?.scopeKey ?? input.scopeKey ?? deriveQueueScopeKey(input.tasks, taskIds),
    sourcePrompt,
    sourcePromptHash: sha256(sourcePrompt),
    sourcePlanPath: resolveQueueSourcePlan(input.tasks),
    targetRepo: resolveQueueTargetRepo(input.tasks),
    taskIds,
    tasks: taskIds.map((taskId) => input.tasks.find((task) => task.workItemId === taskId)).filter((task): task is TaskDirectionTask => Boolean(task)),
    currentIndex,
    status: 'active',
    createdByActor: activeExisting?.createdByActor ?? input.actorId ?? null,
    createdAt: activeExisting?.createdAt ?? now,
    updatedAt: now
  };
  writeTaskQueue(input.cwd, record);
  return record;
}

export function findActiveTaskQueue(cwd: string, sourcePrompt?: string | null, selector: { readonly queueId?: string | null; readonly batchId?: string | null; readonly scopeKey?: string | null; readonly taskId?: string | null } = {}): TaskQueueRecord | null {
  const promptHash = sourcePrompt?.trim() ? sha256(sourcePrompt.trim()) : null;
  const queues = listTaskQueues(cwd).filter((queue) => queue.status === 'active');
  if (selector.queueId) return queues.find((queue) => queue.queueId === selector.queueId) ?? null;
  if (selector.batchId) return queues.find((queue) => queue.batchId === selector.batchId) ?? null;
  if (selector.scopeKey) return queues.find((queue) => queue.scopeKey === selector.scopeKey) ?? null;
  if (selector.taskId) return queues.find((queue) => queue.taskIds.includes(selector.taskId ?? '')) ?? null;
  if (promptHash) {
    const exact = queues.find((queue) => queue.sourcePromptHash === promptHash);
    return exact ?? null;
  }
  return queues.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function abandonTaskQueue(input: {
  readonly cwd: string;
  readonly queueId: string;
  readonly actorId: string;
  readonly reason?: string | null;
}): TaskQueueRecord {
  const record = readTaskQueue(input.cwd, input.queueId);
  if (!record) {
    throw new CliError('ATM_TASK_QUEUE_NOT_FOUND', `Task queue not found: ${input.queueId}`, {
      exitCode: 2,
      details: { queueId: input.queueId }
    });
  }
  const now = new Date().toISOString();
  const abandoned: TaskQueueRecord = {
    ...record,
    status: 'abandoned',
    updatedAt: now,
    abandonedByActor: input.actorId,
    abandonedAt: now,
    ...(input.reason ? { abandonReason: input.reason } : {})
  };
  writeTaskQueue(input.cwd, abandoned);
  return abandoned;
}

export function advanceTaskQueueAfterClose(cwd: string, taskId: string, selector: { readonly batchId?: string | null; readonly queueId?: string | null } = {}): TaskQueueRecord | null {
  const queue = findActiveTaskQueue(cwd, null, { ...selector, taskId });
  if (!queue) return null;
  const currentTaskId = queue.taskIds[queue.currentIndex] ?? null;
  if (currentTaskId !== taskId) return queue;
  const nextIndex = queue.currentIndex + 1;
  const now = new Date().toISOString();
  const updated: TaskQueueRecord = {
    ...queue,
    currentIndex: Math.min(nextIndex, Math.max(0, queue.taskIds.length - 1)),
    status: nextIndex >= queue.taskIds.length ? 'completed' : 'active',
    updatedAt: now
  };
  writeTaskQueue(cwd, updated);
  return updated;
}

export function buildTaskQueueStatus(cwd: string) {
  const activeQueue = findActiveTaskQueue(cwd);
  return {
    activeQueue,
    queueHeadTaskId: activeQueue ? activeQueue.taskIds[activeQueue.currentIndex] ?? null : null
  };
}

export function writeTaskDirectionLock(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly queue: TaskQueueRecord | null;
  readonly batchId?: string | null;
  readonly scopeKey?: string | null;
  readonly allowedFiles: readonly string[];
  readonly planningReadOnlyPaths?: readonly string[];
  readonly planningMirrorPaths?: readonly string[];
  readonly allowPlanningMirror?: boolean;
  readonly prompt?: string | null;
}) {
  const queueIndex = input.queue ? input.queue.taskIds.indexOf(input.taskId) : -1;
  // TASK-AAO-0058：claim 時自動將任務自身治理路徑隱式 self-allow，
  // 讓 agent 在 evidence 收集、checkpoint 或 close 時不受 ScopeLock 阻擋。
  const mergedAllowedFiles = sanitizeTaskDirectionAllowedFiles([
    ...input.allowedFiles,
    ...buildTaskSelfAllowPaths(input.taskId)
  ]);
  const lock: TaskDirectionLock = {
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId: input.taskId,
    batchId: input.batchId ?? input.queue?.batchId ?? null,
    scopeKey: input.scopeKey ?? input.queue?.scopeKey ?? null,
    queueId: input.queue?.queueId ?? null,
    queueIndex: queueIndex >= 0 ? queueIndex : null,
    allowedFiles: mergedAllowedFiles,
    planningReadOnlyPaths: sanitizeTaskDirectionAllowedFiles(input.planningReadOnlyPaths ?? []),
    planningMirrorPaths: sanitizeTaskDirectionAllowedFiles(input.planningMirrorPaths ?? []),
    allowPlanningMirror: input.allowPlanningMirror === true,
    promptHash: input.prompt?.trim() ? sha256(input.prompt.trim()) : input.queue?.sourcePromptHash ?? null,
    actorId: input.actorId,
    createdAt: new Date().toISOString(),
    status: 'active'
  };
  const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const { released, releasedAt, releasedBy, ...activeLock } = existing;
      writeJson(lockPath, {
        ...activeLock,
        files: [...lock.allowedFiles],
        status: 'active',
        taskDirectionLock: lock
      });
      return lock;
    } catch {
      // Fall through to sidecar if the governance lock is not parseable.
    }
  }
  const sidecarPath = path.join(input.cwd, '.atm', 'runtime', 'task-direction-locks', `${input.taskId}.json`);
  mkdirSync(path.dirname(sidecarPath), { recursive: true });
  writeJson(sidecarPath, lock);
  return lock;
}

export function getCanonicalAllowedFilesForTask(cwd: string, taskId: string): readonly string[] | null {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (existsSync(lockPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const released = parsed.released === true || parsed.status === 'released';
      const embedded = parsed.taskDirectionLock;
      if (!released && isTaskDirectionLock(embedded)) return embedded.allowedFiles;
    } catch {
      // Fall through to sidecar.
    }
  }
  const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
  if (existsSync(sidecarPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      if (isTaskDirectionLock(parsed)) return parsed.allowedFiles;
    } catch {
      // Ignore malformed runtime files.
    }
  }
  return null;
}

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

export function diagnoseTaskDirectionLockAllowedFiles(cwd: string, taskId: string): TaskDirectionAllowedFilesDiagnosis {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  let canonicalAllowedFiles: readonly string[] | null = null;
  let governanceLockFiles: readonly string[] | null = null;
  let hasGovernanceLock = false;
  if (existsSync(lockPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const released = parsed.released === true || parsed.status === 'released';
      if (!released) {
        hasGovernanceLock = true;
        const embedded = parsed.taskDirectionLock;
        if (isTaskDirectionLock(embedded)) canonicalAllowedFiles = embedded.allowedFiles;
        if (Array.isArray(parsed.files)) {
          governanceLockFiles = uniqueSorted(parsed.files.filter((entry): entry is string => typeof entry === 'string').map(normalizeRelativePath));
        }
      }
    } catch {
      // Ignore malformed runtime files.
    }
  }
  if (!canonicalAllowedFiles) {
    canonicalAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId);
  }
  let claimFiles: readonly string[] | null = null;
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (existsSync(taskPath)) {
    try {
      const parsed = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
      const claim = (parsed as { claim?: unknown }).claim;
      if (claim && typeof claim === 'object' && Array.isArray((claim as { files?: unknown }).files)) {
        claimFiles = uniqueSorted(((claim as { files: unknown[] }).files)
          .filter((entry): entry is string => typeof entry === 'string')
          .map(normalizeRelativePath));
      }
    } catch {
      // Ignore malformed ledger files.
    }
  }
  const mismatches: TaskDirectionAllowedFilesMismatch[] = [];
  if (canonicalAllowedFiles && governanceLockFiles) {
    const drift = computeAllowedFilesDrift(canonicalAllowedFiles, governanceLockFiles);
    if (drift.missingFromSource.length > 0 || drift.extraInSource.length > 0) {
      mismatches.push({ source: 'governance-lock-files', ...drift });
    }
  }
  if (canonicalAllowedFiles && claimFiles) {
    const drift = computeAllowedFilesDrift(canonicalAllowedFiles, claimFiles);
    if (drift.missingFromSource.length > 0 || drift.extraInSource.length > 0) {
      mismatches.push({ source: 'claim-files', ...drift });
    }
  }
  return { taskId, hasGovernanceLock, canonicalAllowedFiles, governanceLockFiles, claimFiles, mismatches };
}

function computeAllowedFilesDrift(canonical: readonly string[], source: readonly string[]) {
  const canonicalSet = new Set(canonical.map((value) => normalizeRelativePath(value).toLowerCase()));
  const sourceSet = new Set(source.map((value) => normalizeRelativePath(value).toLowerCase()));
  const missingFromSource = [...canonicalSet].filter((value) => !sourceSet.has(value)).sort();
  const extraInSource = [...sourceSet].filter((value) => !canonicalSet.has(value)).sort();
  return { missingFromSource, extraInSource };
}

export function readActiveTaskDirectionLocks(cwd: string): readonly TaskDirectionLock[] {
  const locks: TaskDirectionLock[] = [];
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (existsSync(lockRoot)) {
    for (const entry of readdirSync(lockRoot).filter((item) => item.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8')) as Record<string, unknown>;
        const released = parsed.released === true || parsed.status === 'released';
        const embedded = parsed.taskDirectionLock;
        if (!released && isTaskDirectionLock(embedded)) locks.push(embedded);
      } catch {
        // Ignore malformed runtime files; task audit owns persistent task validation.
      }
    }
  }
  const sidecarRoot = path.join(cwd, '.atm', 'runtime', 'task-direction-locks');
  if (existsSync(sidecarRoot)) {
    for (const entry of readdirSync(sidecarRoot).filter((item) => item.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(readFileSync(path.join(sidecarRoot, entry), 'utf8'));
        if (isTaskDirectionLock(parsed)) locks.push(parsed);
      } catch {
        // Ignore malformed runtime files.
      }
    }
  }
  return dedupeDirectionLocks(locks);
}

export function assertTaskCloseAllowedByDirection(cwd: string, taskId: string, actorId: string) {
  const activeQueue = findActiveTaskQueue(cwd, null, { taskId });
  if (activeQueue) {
    const currentTaskId = activeQueue.taskIds[activeQueue.currentIndex] ?? null;
    if (currentTaskId && currentTaskId !== taskId) {
      throw new CliError('ATM_TASK_QUEUE_HEAD_REQUIRED', `Task ${taskId} cannot close before queue head ${currentTaskId}.`, {
        exitCode: 1,
        details: { taskId, queueId: activeQueue.queueId, queueHeadTaskId: currentTaskId }
      });
    }
  }
  const matchingLock = readGovernanceDirectionLockForTask(cwd, taskId);
  if (!matchingLock) {
    const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
    if (existsSync(sidecarPath)) {
      throw new CliError('ATM_TASK_CLOSE_INVALID_DIRECTION_LOCK_SOURCE', `Task ${taskId} cannot close as done from a standalone direction lock sidecar.`, {
        exitCode: 1,
        details: {
          taskId,
          sidecarPath: relativePathFrom(cwd, sidecarPath),
          requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json`
        }
      });
    }
    throw new CliError('ATM_TASK_DIRECTION_LOCK_REQUIRED', `Task ${taskId} cannot close as done without an active task direction lock.`, {
      exitCode: 1,
      details: { taskId, requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json` }
    });
  }
  if (matchingLock.actorId !== actorId) {
    throw new CliError('ATM_TASK_DIRECTION_LOCK_OWNER_MISMATCH', `Task ${taskId} direction lock belongs to ${matchingLock.actorId}, not ${actorId}.`, {
      exitCode: 1,
      details: { taskId, actorId, lockActorId: matchingLock.actorId }
    });
  }
}

export function buildAllowedFilesForTask(task: TaskDirectionTask): readonly string[] {
  return partitionTaskScope(task).targetWork.allowedFiles;
}

/**
 * TASK-AAO-0058：回傳任務自身治理路徑（task self-allow）的 canonical 三條路徑。
 * 這些路徑會在 writeTaskDirectionLock 建立鎖時自動併入 allowedFiles，
 * 讓 agent 在 evidence 收集、checkpoint 或 close 時不會被 ScopeLock 阻擋。
 *
 * 覆蓋範圍：
 *   - .atm/history/tasks/<task-id>.json
 *   - .atm/history/evidence/<task-id>.* （含 closure-packet.json）
 *   - .atm/history/task-events/<task-id>/**
 *
 * 不含整個 .atm/history/**，以保持精確邊界。
 */
export function buildTaskSelfAllowPaths(taskId: string): readonly string[] {
  return [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.*`,
    `.atm/history/task-events/${taskId}/**`
  ];
}

export function partitionTaskScope(task: TaskDirectionTask): TaskScopePartition {
  const planningReadOnlyPaths = sanitizeTaskDirectionAllowedFiles([
    task.sourcePlanPath ?? '',
    ...task.nearbyPlanPaths,
    ...task.scopePaths.filter(isExternalPlanningPath)
  ]);
  const planningMirrorPaths = uniqueSorted(planningReadOnlyPaths.flatMap(derivePlanningMirrorGuardPaths));
  const targetCandidates = sanitizeTaskDirectionAllowedFiles(task.scopePaths);
  const allowedFiles = targetCandidates.filter((entry) => {
    if (planningReadOnlyPaths.includes(entry)) return false;
    if (!task.allowPlanningMirror && isPlanningMirrorPath(entry, planningMirrorPaths)) return false;
    return true;
  });
  return {
    planningContext: {
      readOnlyPaths: planningReadOnlyPaths
    },
    targetWork: {
      allowedFiles,
      planningMirrorPaths,
      allowPlanningMirror: task.allowPlanningMirror
    }
  };
}

export function sanitizeTaskDirectionAllowedFiles(values: readonly string[]): readonly string[] {
  return uniqueSorted(values
    .map(normalizeRelativePath)
    .filter(isTaskDirectionPathCandidate));
}

export function isTaskDirectionPathCandidate(value: string): boolean {
  const normalized = normalizeRelativePath(value);
  if (!normalized || normalized.length > 260 || /[\r\n]/.test(normalized)) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (/\s\/|\/\s/.test(normalized)) return false;

  const knownRoots = [
    '.atm/',
    '.github/',
    '.claude/',
    '.cursor/',
    '.gemini/',
    'atomic_workbench/',
    'docs/',
    'examples/',
    'fixtures/',
    'integrations/',
    'packages/',
    'pipelines/',
    'release/',
    'schemas/',
    'scripts/',
    'specs/',
    'templates/',
    'tests/',
    '文件/'
  ];
  if (knownRoots.some((root) => normalized === root.slice(0, -1) || normalized.startsWith(root))) return true;
  if (normalized.includes('*') && normalized.includes('/')) return true;

  const lastSegment = normalized.split('/').pop() ?? normalized;
  return /^[^<>:"|?*]+\.[A-Za-z0-9][A-Za-z0-9._-]{0,12}$/.test(lastSegment);
}

export function isPlanningMirrorPath(filePath: string, planningMirrorPaths: readonly string[]): boolean {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  return planningMirrorPaths.some((candidate) => matchesPlanningMirrorPath(normalizedFile, normalizeRelativePath(candidate).toLowerCase()));
}

function listTaskQueues(cwd: string): readonly TaskQueueRecord[] {
  const root = path.join(cwd, '.atm', 'runtime', 'task-queues');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry) => {
      const record = readTaskQueue(cwd, entry.replace(/\.json$/, ''));
      return record ? [record] : [];
    });
}

function readTaskQueue(cwd: string, queueId: string): TaskQueueRecord | null {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'task-queues', `${queueId}.json`);
  if (!existsSync(queuePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(queuePath, 'utf8')) as TaskQueueRecord;
    return parsed.schemaId === 'atm.taskQueue.v1'
      ? {
        ...parsed,
        batchId: parsed.batchId ?? null,
        scopeKey: parsed.scopeKey ?? deriveQueueScopeKey(parsed.tasks ?? [], parsed.taskIds ?? [])
      }
      : null;
  } catch {
    return null;
  }
}

function writeTaskQueue(cwd: string, record: TaskQueueRecord) {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'task-queues', `${record.queueId}.json`);
  mkdirSync(path.dirname(queuePath), { recursive: true });
  writeJson(queuePath, record);
}

function buildQueueId(sourcePrompt: string, taskIds: readonly string[]) {
  return `queue-${sha256([sourcePrompt.trim(), ...taskIds].join('\n')).slice(0, 16)}`;
}

function deriveQueueScopeKey(tasks: readonly TaskDirectionTask[], taskIds: readonly string[]) {
  const idRoots = uniqueSorted(taskIds.map((taskId) => {
    const match = taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/);
    return match?.[1] ?? '';
  }).filter(Boolean));
  if (idRoots.length === 1) return idRoots[0] ?? null;
  const planPaths = uniqueSorted(tasks.map((task) => task.sourcePlanPath).filter((entry): entry is string => Boolean(entry)));
  if (planPaths.length === 1) return `plan-${sha256(planPaths[0] ?? '').slice(0, 12)}`;
  if (taskIds.length > 0) return `tasks-${sha256(taskIds.join('\n')).slice(0, 12)}`;
  return null;
}

function resolveQueueSourcePlan(tasks: readonly TaskDirectionTask[]) {
  const paths = uniqueSorted(tasks.map((task) => task.sourcePlanPath).filter((entry): entry is string => Boolean(entry)));
  return paths.length === 1 ? paths[0] : null;
}

function resolveQueueTargetRepo(tasks: readonly TaskDirectionTask[]) {
  const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry): entry is string => Boolean(entry)));
  return targets.length === 1 ? targets[0] : null;
}

function isTaskDirectionLock(value: unknown): value is TaskDirectionLock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaId === 'atm.taskDirectionLock.v1'
    && typeof record.taskId === 'string'
    && typeof record.actorId === 'string'
    && record.status === 'active';
}

function dedupeDirectionLocks(locks: readonly TaskDirectionLock[]) {
  const seen = new Set<string>();
  const output: TaskDirectionLock[] = [];
  for (const lock of locks) {
    const key = `${lock.taskId}:${lock.actorId}:${lock.queueId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(lock);
  }
  return output;
}

function readGovernanceDirectionLockForTask(cwd: string, taskId: string): TaskDirectionLock | null {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (!existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const released = parsed.released === true || parsed.status === 'released';
    if (released) return null;
    const embedded = parsed.taskDirectionLock;
    return isTaskDirectionLock(embedded) ? embedded : null;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isExternalPlanningPath(value: string) {
  const normalized = normalizeRelativePath(value);
  return normalized.startsWith('../');
}

function derivePlanningMirrorGuardPaths(value: string): readonly string[] {
  const normalized = normalizeRelativePath(value);
  const docsIndex = normalized.toLowerCase().indexOf('docs/');
  if (docsIndex < 0 || docsIndex === 0) return [];
  const mirrorPath = normalized.slice(docsIndex);
  if (!isTaskDirectionPathCandidate(mirrorPath)) return [];
  const guards = new Set<string>([mirrorPath]);
  let current = path.posix.dirname(mirrorPath);
  while (current && current !== '.' && current !== 'docs') {
    guards.add(`${current}/`);
    current = path.posix.dirname(current);
  }
  return [...guards].sort((left, right) => left.localeCompare(right));
}

function matchesPlanningMirrorPath(filePath: string, mirrorPath: string) {
  if (!mirrorPath) return false;
  if (mirrorPath.endsWith('/')) return filePath === mirrorPath.slice(0, -1) || filePath.startsWith(mirrorPath);
  if (filePath === mirrorPath) return true;
  return filePath.startsWith(`${mirrorPath}/`);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueInOrder(values: readonly string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map(normalizeRelativePath).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function toProjectPath(cwd: string, absolutePath: string) {
  return relativePathFrom(cwd, absolutePath).replace(/\\/g, '/');
}
