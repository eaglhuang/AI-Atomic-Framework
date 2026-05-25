import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TaskDirectionTask, TaskQueueRecord } from './task-direction.ts';

export interface QuickfixLock {
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
  readonly schemaId: 'atm.batchRun.v1';
  readonly specVersion: '0.1.0';
  readonly batchId: string;
  readonly sourcePrompt: string;
  readonly sourcePromptHash: string;
  readonly targetRepo: string | null;
  readonly taskIds: readonly string[];
  readonly currentIndex: number;
  readonly currentTaskId: string | null;
  readonly commitMode: 'per-task' | 'checkpoint' | 'single';
  readonly checkpointSize: number;
  readonly status: 'active' | 'paused' | 'completed' | 'abandoned';
  readonly createdByActor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const quickfixLockPath = ['.atm', 'runtime', 'quickfix-lock.json'] as const;
const batchRunPath = ['.atm', 'runtime', 'batch-run.json'] as const;

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

export function readActiveBatchRun(cwd: string): BatchRunRecord | null {
  const filePath = path.join(cwd, ...batchRunPath);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as BatchRunRecord;
    if (parsed.schemaId !== 'atm.batchRun.v1' || parsed.status !== 'active') return null;
    return parsed;
  } catch {
    return null;
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
  const filePath = path.join(input.cwd, ...batchRunPath);
  const currentIndex = input.queue?.currentIndex ?? 0;
  const record: BatchRunRecord = {
    schemaId: 'atm.batchRun.v1',
    specVersion: '0.1.0',
    batchId: `batch-${sha256(`${prompt}|${taskIds.join(',')}`).slice(0, 12)}`,
    sourcePrompt: prompt,
    sourcePromptHash: sha256(prompt),
    targetRepo: input.queue?.targetRepo ?? resolveBatchTargetRepo(sourceTasks),
    taskIds,
    currentIndex,
    currentTaskId: taskIds[currentIndex] ?? null,
    commitMode: input.commitMode ?? 'per-task',
    checkpointSize: Math.max(1, input.checkpointSize ?? 3),
    status: 'active',
    createdByActor: input.actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function updateBatchRun(cwd: string, current: BatchRunRecord, updates: Partial<BatchRunRecord>) {
  const filePath = path.join(cwd, ...batchRunPath);
  const record: BatchRunRecord = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function releaseBatchRun(cwd: string, current: BatchRunRecord, status: BatchRunRecord['status']) {
  return updateBatchRun(cwd, current, {
    status,
    currentTaskId: status === 'completed' ? null : current.currentTaskId
  });
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
    targetRepo: taskQueue.targetRepo,
    taskIds: [...taskQueue.taskIds],
    currentIndex: taskQueue.currentIndex,
    currentTaskId: queueHeadTaskId,
    status: taskQueue.status === 'completed' || !queueHeadTaskId ? 'completed' : 'active'
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

export function isPathAllowedByScope(filePath: string, allowedFiles: readonly string[]) {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  if (!normalizedFile) return false;
  return allowedFiles.some((entry) => {
    const candidate = normalizeRelativePath(entry).toLowerCase();
    if (!candidate) return false;
    if (candidate.includes('*')) {
      const escaped = candidate
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__ATM_DOUBLE_STAR__/g, '.*');
      return new RegExp(`^${escaped}$`).test(normalizedFile);
    }
    return normalizedFile === candidate || normalizedFile.startsWith(`${candidate}/`);
  });
}

function resolveBatchTargetRepo(tasks: readonly TaskDirectionTask[]) {
  return tasks.find((task) => task.targetRepo)?.targetRepo ?? null;
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
