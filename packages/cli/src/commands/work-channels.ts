import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TaskDirectionTask, TaskQueueRecord } from './task-direction.ts';
import { normalizeStoredPlanningPathForIdentity } from './planning-repo-root.ts';

export interface QuickfixLock {
  readonly [key: string]: unknown;
  readonly schemaId: 'atm.quickfixLock.v1';
  readonly specVersion: '0.1.0';
  readonly actorId: string;
  readonly prompt: string;
  readonly promptHash: string;
  readonly reason: string | null;
  readonly allowedFiles: readonly string[];
  readonly maxFiles: number;
  readonly maxChangedLines: number;
  readonly createdAt: string;
  readonly status: 'active' | 'released';
}

export interface BatchRunRecord {
  readonly [key: string]: unknown;
  readonly schemaId: 'atm.batchRun.v1';
  readonly specVersion: '0.1.0';
  readonly batchId: string;
  readonly scopeKey: string;
  readonly queueId: string | null;
  readonly sourcePrompt: string;
  readonly sourcePromptHash: string;
  readonly targetRepo: string | null;
  readonly taskIds: readonly string[];
  readonly currentIndex: number;
  readonly currentTaskId: string | null;
  readonly commitMode: 'per-task' | 'checkpoint' | 'single';
  readonly checkpointSize: number;
  readonly pendingCommitTaskId?: string | null;
  readonly status: 'active' | 'paused' | 'completed' | 'abandoned';
  readonly hold?: BatchRunHold | null;
  readonly skippedTasks?: readonly BatchSkippedTaskRecord[];
  readonly createdByActor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BatchRunHold {
  readonly [key: string]: unknown;
  readonly schemaId: 'atm.batchHold.v1';
  readonly status: 'held';
  readonly afterTaskId: string;
  readonly currentTaskId: string | null;
  readonly heldByActor: string;
  readonly heldAt: string;
  readonly resumeCommand: string;
}

export interface BatchSkippedTaskRecord {
  readonly [key: string]: unknown;
  readonly schemaId: 'atm.batchSkippedTask.v1';
  readonly taskId: string;
  readonly reason: string;
  readonly skippedByActor: string;
  readonly skippedAt: string;
  readonly batchIndex: number;
  readonly resumeCommand: string;
}

const quickfixLockPath = ['.atm', 'runtime', 'quickfix-lock.json'] as const;
const batchRunPath = ['.atm', 'runtime', 'batch-run.json'] as const;
const batchRunsPath = ['.atm', 'runtime', 'batch-runs'] as const;

export interface BatchRunSelector {
  readonly batchId?: string | null;
  readonly scopeKey?: string | null;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly sourcePrompt?: string | null;
}

export function readActiveQuickfixLock(cwd: string): QuickfixLock | null {
  const filePath = path.join(cwd, ...quickfixLockPath);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as QuickfixLock;
    if (parsed.schemaId !== 'atm.quickfixLock.v1' || parsed.status !== 'active') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeQuickfixLock(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly prompt: string;
  readonly reason?: string | null;
  readonly allowedFiles: readonly string[];
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
}) {
  const filePath = path.join(input.cwd, ...quickfixLockPath);
  const record: QuickfixLock = {
    schemaId: 'atm.quickfixLock.v1',
    specVersion: '0.1.0',
    actorId: input.actorId,
    prompt: input.prompt,
    promptHash: sha256(input.prompt),
    reason: input.reason ?? null,
    allowedFiles: uniqueStrings(input.allowedFiles.map(normalizeRelativePath).filter(Boolean)),
    maxFiles: input.maxFiles ?? 3,
    maxChangedLines: input.maxChangedLines ?? 80,
    createdAt: new Date().toISOString(),
    status: 'active'
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function releaseQuickfixLock(cwd: string, actorId: string) {
  const active = readActiveQuickfixLock(cwd);
  if (!active || active.actorId !== actorId) return null;
  const filePath = path.join(cwd, ...quickfixLockPath);
  const released: QuickfixLock = {
    ...active,
    status: 'released'
  };
  writeFileSync(filePath, `${JSON.stringify(released, null, 2)}\n`, 'utf8');
  return released;
}

export function readActiveBatchRun(cwd: string, selector: BatchRunSelector = {}): BatchRunRecord | null {
  return selectActiveBatchRun(cwd, selector);
}

export function listActiveBatchRuns(cwd: string): readonly BatchRunRecord[] {
  return dedupeBatchRuns([
    ...listBatchRuns(cwd),
    ...readLegacyBatchRun(cwd)
  ])
    .filter((entry) => entry.status === 'active')
    .map((entry) => normalizeBatchRunForTerminalLedgerTasks(cwd, entry))
    .filter((entry) => entry.status === 'active');
}

export function readBatchRunById(cwd: string, batchId: string): BatchRunRecord | null {
  const normalized = normalizeBatchId(batchId);
  if (!normalized) return null;
  const filePath = path.join(cwd, ...batchRunsPath, `${normalized}.json`);
  const direct = readBatchRunFile(filePath);
  if (direct) return direct;
  return listBatchRuns(cwd).find((entry) => entry.batchId === normalized) ?? readLegacyBatchRun(cwd).find((entry) => entry.batchId === normalized) ?? null;
}

export function findActiveBatchRunForTask(cwd: string, taskId: string): BatchRunRecord | null {
  return selectActiveBatchRun(cwd, { taskId });
}

export function selectActiveBatchRun(cwd: string, selector: BatchRunSelector = {}): BatchRunRecord | null {
  const active = listActiveBatchRuns(cwd);
  const batchId = normalizeBatchId(selector.batchId ?? '');
  if (batchId) return active.find((entry) => entry.batchId === batchId) ?? null;
  const sourcePromptHash = selector.sourcePrompt?.trim() ? sha256(selector.sourcePrompt.trim()) : null;
  const scopeKey = normalizeOptionalSelector(selector.scopeKey);
  const taskId = normalizeOptionalSelector(selector.taskId);
  const actorId = normalizeOptionalSelector(selector.actorId);
  const filtered = active.filter((entry) => {
    if (scopeKey && entry.scopeKey !== scopeKey) return false;
    if (taskId && !entry.taskIds.includes(taskId)) return false;
    if (actorId && entry.createdByActor !== actorId) return false;
    if (sourcePromptHash && entry.sourcePromptHash !== sourcePromptHash) return false;
    return true;
  });
  if (filtered.length === 1) return filtered[0] ?? null;
  return null;
}

export function activeBatchSelectionStatus(cwd: string, selector: BatchRunSelector = {}) {
  const active = listActiveBatchRuns(cwd);
  const batchId = normalizeBatchId(selector.batchId ?? '');
  if (batchId) {
    const batchRun = active.find((entry) => entry.batchId === batchId) ?? null;
    return {
      ok: Boolean(batchRun),
      reason: batchRun ? null : 'batch-not-found',
      batchRun,
      candidates: batchRun ? [batchRun] : []
    };
  }
  const sourcePromptHash = selector.sourcePrompt?.trim() ? sha256(selector.sourcePrompt.trim()) : null;
  const scopeKey = normalizeOptionalSelector(selector.scopeKey);
  const taskId = normalizeOptionalSelector(selector.taskId);
  const actorId = normalizeOptionalSelector(selector.actorId);
  const candidates = active.filter((entry) => {
    if (scopeKey && entry.scopeKey !== scopeKey) return false;
    if (taskId && !entry.taskIds.includes(taskId)) return false;
    if (actorId && entry.createdByActor !== actorId) return false;
    if (sourcePromptHash && entry.sourcePromptHash !== sourcePromptHash) return false;
    return true;
  });
  return {
    ok: candidates.length === 1,
    reason: candidates.length === 0 ? 'batch-not-found' : candidates.length > 1 ? 'batch-selection-required' : null,
    batchRun: candidates.length === 1 ? candidates[0] ?? null : null,
    candidates
  };
}

function readLegacyBatchRun(cwd: string): readonly BatchRunRecord[] {
  const filePath = path.join(cwd, ...batchRunPath);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as BatchRunRecord;
    if (parsed.schemaId !== 'atm.batchRun.v1') return [];
    return [normalizeBatchRunRecord(parsed)];
  } catch {
    return [];
  }
}

export function writeBatchRun(input: {
  readonly cwd: string;
  readonly sourcePrompt: string;
  readonly tasks: readonly TaskDirectionTask[];
  readonly queue: TaskQueueRecord | null;
  readonly actorId: string | null;
  readonly commitMode?: 'per-task' | 'checkpoint' | 'single';
  readonly checkpointSize?: number;
}) {
  const prompt = input.sourcePrompt.trim();
  const queueTasks = input.queue?.tasks ?? null;
  const sourceTasks = queueTasks && queueTasks.length > 0 ? queueTasks : input.tasks;
  const taskIds = input.queue?.taskIds && input.queue.taskIds.length > 0
    ? [...input.queue.taskIds]
    : sourceTasks.map((task) => task.workItemId);
  const currentIndex = input.queue?.currentIndex ?? 0;
  const batchId = `batch-${sha256(`${prompt}|${taskIds.join(',')}`).slice(0, 12)}`;
  const record: BatchRunRecord = {
    schemaId: 'atm.batchRun.v1',
    specVersion: '0.1.0',
    batchId,
    scopeKey: deriveBatchScopeKey(sourceTasks, prompt, taskIds, input.cwd),
    queueId: input.queue?.queueId ?? null,
    sourcePrompt: prompt,
    sourcePromptHash: sha256(prompt),
    targetRepo: input.queue?.targetRepo ?? resolveBatchTargetRepo(sourceTasks),
    taskIds,
    currentIndex,
    currentTaskId: taskIds[currentIndex] ?? null,
    commitMode: input.commitMode ?? 'per-task',
    checkpointSize: Math.max(1, input.checkpointSize ?? 3),
    pendingCommitTaskId: null,
    status: 'active',
    createdByActor: input.actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeBatchRunRecord(input.cwd, record);
  return record;
}

export function updateBatchRun(cwd: string, current: BatchRunRecord, updates: Partial<BatchRunRecord>) {
  const record: BatchRunRecord = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  writeBatchRunRecord(cwd, record);
  return record;
}

export function releaseBatchRun(cwd: string, current: BatchRunRecord, status: BatchRunRecord['status']) {
  return updateBatchRun(cwd, current, {
    status,
    currentTaskId: status === 'completed' ? null : current.currentTaskId,
    hold: null
  });
}

function normalizeBatchRunForTerminalLedgerTasks(cwd: string, batchRun: BatchRunRecord): BatchRunRecord {
  if (batchRun.status !== 'active') return batchRun;
  const nextOpenIndex = findNextOpenBatchTaskIndex(cwd, batchRun, batchRun.currentIndex);
  if (nextOpenIndex === batchRun.currentIndex) return batchRun;
  if (nextOpenIndex >= batchRun.taskIds.length) {
    return releaseBatchRun(cwd, batchRun, 'completed');
  }
  return updateBatchRun(cwd, batchRun, {
    currentIndex: nextOpenIndex,
    currentTaskId: batchRun.taskIds[nextOpenIndex] ?? null,
    hold: null
  });
}

function findNextOpenBatchTaskIndex(cwd: string, batchRun: BatchRunRecord, startIndex: number): number {
  for (let index = startIndex; index < batchRun.taskIds.length; index += 1) {
    const taskId = batchRun.taskIds[index];
    if (!taskId || isLedgerTerminalBatchTask(cwd, taskId)) continue;
    return index;
  }
  return batchRun.taskIds.length;
}

function isLedgerTerminalBatchTask(cwd: string, taskId: string): boolean {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
    return status === 'done'
      || status === 'abandoned'
      || typeof parsed.closedAt === 'string'
      || typeof parsed.closedByActor === 'string';
  } catch {
    return false;
  }
}

export function inspectBatchRunConsistency(batchRun: BatchRunRecord | null, taskQueue: TaskQueueRecord | null) {
  if (!batchRun || batchRun.status !== 'active') {
    return {
      ok: true,
      reason: null,
      queueHeadTaskId: null,
      batchHeadTaskId: null
    };
  }
  if (!taskQueue || taskQueue.status !== 'active') {
    return {
      ok: false,
      reason: 'active-batch-without-active-queue',
      queueHeadTaskId: null,
      batchHeadTaskId: batchRun.currentTaskId
    };
  }
  const queueHeadTaskId = taskQueue.taskIds[taskQueue.currentIndex] ?? null;
  const sameTaskIds = JSON.stringify([...batchRun.taskIds]) === JSON.stringify([...taskQueue.taskIds]);
  const sameIndex = batchRun.currentIndex === taskQueue.currentIndex;
  const sameHead = batchRun.currentTaskId === queueHeadTaskId;
  if (sameTaskIds && sameIndex && sameHead) {
    return {
      ok: true,
      reason: null,
      queueHeadTaskId,
      batchHeadTaskId: batchRun.currentTaskId
    };
  }
  return {
    ok: false,
    reason: 'batch-run-task-queue-mismatch',
    queueHeadTaskId,
    batchHeadTaskId: batchRun.currentTaskId
  };
}

export function repairBatchRunFromQueue(cwd: string, batchRun: BatchRunRecord, taskQueue: TaskQueueRecord) {
  const queueHeadTaskId = taskQueue.taskIds[taskQueue.currentIndex] ?? null;
  return updateBatchRun(cwd, batchRun, {
    queueId: taskQueue.queueId,
    scopeKey: taskQueue.scopeKey ?? batchRun.scopeKey,
    targetRepo: taskQueue.targetRepo,
    taskIds: [...taskQueue.taskIds],
    currentIndex: taskQueue.currentIndex,
    currentTaskId: queueHeadTaskId,
    status: taskQueue.status === 'completed' || !queueHeadTaskId ? 'completed' : 'active'
  });
}

export function findBatchFileConflicts(input: {
  readonly currentBatchId: string | null;
  readonly files: readonly string[];
  readonly otherBatches: readonly BatchRunRecord[];
  readonly allowedFilesByBatchId: ReadonlyMap<string, readonly string[]>;
}) {
  const files = input.files.map(normalizeRelativePath).filter(Boolean).filter((entry) => !entry.toLowerCase().startsWith('.atm/history/'));
  return input.otherBatches.flatMap((batchRun) => {
    if (input.currentBatchId && batchRun.batchId === input.currentBatchId) return [];
    const allowedFiles = input.allowedFilesByBatchId.get(batchRun.batchId) ?? [];
    const overlappingFiles = files.filter((file) => isPathAllowedByScope(file, allowedFiles));
    if (overlappingFiles.length === 0) return [];
    return [{
      batchId: batchRun.batchId,
      scopeKey: batchRun.scopeKey,
      taskIds: batchRun.taskIds,
      overlappingFiles: uniqueStrings(overlappingFiles)
    }];
  });
}

export function extractPathLikeStringsFromPrompt(prompt: string): readonly string[] {
  const candidates = new Set<string>();
  const matches = prompt.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|pipelines|src|data|fixtures|README\.md|atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)(?:[\\/][A-Za-z0-9._-]+)*(?:\.[A-Za-z0-9._-]+)?\b/gi);
  for (const match of matches) {
    const normalized = normalizeRelativePath(match[0]);
    if (normalized) candidates.add(normalized);
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function isQuickfixPrompt(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(typo|small fix|quick fix|quickfix|one line|one-line|rename|minor fix|hotfix)\b/.test(normalized)
    || /(小改|小修|小修正|快速修|快修|修一行|改一行|改個 typo|小 typo|小錯字|熱修)/.test(prompt);
}

export function isBatchPrompt(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(all task cards|whole plan|entire plan|batch|all tasks|complete .* tasks)\b/.test(normalized)
    || /(全部任務卡|整份計畫|整個計畫|全部任務|批次完成|整批處理|一次做完|全部做完)/.test(prompt);
}

/**
 * Quickfix / batch scope path matcher. NOT the source of truth for task direction
 * lock allowed files. For task direction governance (claim → guard → close) use
 * `taskDirectionLock.allowedFiles` via `getCanonicalAllowedFilesForTask` /
 * `diagnoseTaskDirectionLockAllowedFiles` in `task-direction.ts` (TASK-AAO-0012).
 */
export function isPathAllowedByScope(filePath: string, allowedFiles: readonly string[]) {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  if (!normalizedFile) return false;
  return allowedFiles.some((entry) => {
    const candidate = normalizeRelativePath(entry).toLowerCase();
    if (!candidate) return false;
    if (candidate.includes('*')) {
      // `dir/**/*.ts` must match `dir/foo.ts` (zero intermediate directories).
      // Treat `**/` as an optional path prefix before single-segment wildcards.
      const escaped = candidate
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '__ATM_GLOBSTAR_SLASH__')
        .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__ATM_GLOBSTAR_SLASH__/g, '(?:.*/)?')
        .replace(/__ATM_DOUBLE_STAR__/g, '.*');
      return new RegExp(`^${escaped}$`).test(normalizedFile);
    }
    return normalizedFile === candidate || normalizedFile.startsWith(`${candidate}/`);
  });
}

function resolveBatchTargetRepo(tasks: readonly TaskDirectionTask[]) {
  return tasks.find((task) => task.targetRepo)?.targetRepo ?? null;
}

function writeBatchRunRecord(cwd: string, record: BatchRunRecord) {
  const recordPath = path.join(cwd, ...batchRunsPath, `${record.batchId}.json`);
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  // Keep the historical single-file location as a compatibility pointer for
  // older runners and adoption repos during the scoped-batch migration.
  const legacyPath = path.join(cwd, ...batchRunPath);
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function listBatchRuns(cwd: string): readonly BatchRunRecord[] {
  const root = path.join(cwd, ...batchRunsPath);
  if (!existsSync(root)) return [];
  try {
    return readDirJsonFiles(root).flatMap((filePath) => {
      const record = readBatchRunFile(filePath);
      return record ? [record] : [];
    });
  } catch {
    return [];
  }
}

function readBatchRunFile(filePath: string): BatchRunRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as BatchRunRecord;
    if (parsed.schemaId !== 'atm.batchRun.v1') return null;
    return normalizeBatchRunRecord(parsed);
  } catch {
    return null;
  }
}

function readDirJsonFiles(root: string): readonly string[] {
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(root, entry));
}

function normalizeBatchRunRecord(record: BatchRunRecord): BatchRunRecord {
  const taskIds = Array.isArray(record.taskIds) ? record.taskIds.map(String).filter(Boolean) : [];
  return {
    ...record,
    scopeKey: record.scopeKey || deriveBatchScopeKey([], record.sourcePrompt ?? '', taskIds),
    queueId: record.queueId ?? null,
    taskIds,
    pendingCommitTaskId: typeof record.pendingCommitTaskId === 'string' && record.pendingCommitTaskId.trim().length > 0
      ? record.pendingCommitTaskId
      : null,
    skippedTasks: Array.isArray(record.skippedTasks) ? record.skippedTasks : []
  };
}

export function writeBatchTaskAuditEvent(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly action: 'batch-skip' | 'batch-resume';
  readonly actorId: string;
  readonly batchId: string;
  readonly reason?: string | null;
  readonly batchIndex?: number | null;
}) {
  const createdAt = new Date().toISOString();
  const digest = sha256(JSON.stringify({
    taskId: input.taskId,
    action: input.action,
    actorId: input.actorId,
    batchId: input.batchId,
    reason: input.reason ?? null,
    batchIndex: input.batchIndex ?? null,
    createdAt
  })).slice(0, 12);
  const transitionId = `${createdAt.replace(/[:.]/g, '-')}-${input.action}-${digest}`;
  const event = {
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId,
    taskId: input.taskId,
    action: input.action,
    actorId: input.actorId,
    batchId: input.batchId,
    reason: input.reason ?? null,
    batchIndex: input.batchIndex ?? null,
    createdAt,
    command: `node atm.mjs batch ${input.action === 'batch-skip' ? 'skip' : 'resume'} --task ${input.taskId} --batch ${input.batchId} --actor ${input.actorId} --json`
  };
  const eventDir = path.join(input.cwd, '.atm', 'history', 'task-events', input.taskId);
  mkdirSync(eventDir, { recursive: true });
  const eventPath = path.join(eventDir, `${transitionId}.json`);
  writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return {
    transitionId,
    eventPath: normalizeRelativePath(path.relative(input.cwd, eventPath))
  };
}

function dedupeBatchRuns(records: readonly BatchRunRecord[]) {
  const seen = new Set<string>();
  const output: BatchRunRecord[] = [];
  for (const record of records) {
    if (!record.batchId || seen.has(record.batchId)) continue;
    seen.add(record.batchId);
    output.push(record);
  }
  return output.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function deriveBatchScopeKey(tasks: readonly TaskDirectionTask[], prompt: string, taskIds: readonly string[], cwd?: string) {
  const idRoots = uniqueStrings(taskIds.map((taskId) => {
    const match = taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/);
    return match?.[1] ?? '';
  }).filter(Boolean));
  if (idRoots.length === 1) return idRoots[0] ?? 'custom';
  const planPaths = uniqueStrings(tasks
    .map((task) => task.sourcePlanPath)
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => cwd ? normalizeStoredPlanningPathForIdentity(cwd, entry) : entry));
  if (planPaths.length === 1) return `plan-${sha256(planPaths[0] ?? '').slice(0, 12)}`;
  if (taskIds.length > 0) return `tasks-${sha256(taskIds.join('\n')).slice(0, 12)}`;
  return `prompt-${sha256(prompt).slice(0, 12)}`;
}

function normalizeBatchId(value: string) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}

function normalizeOptionalSelector(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRelativePath(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized.length > 0 ? normalized : '';
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
