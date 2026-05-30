import * as path from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync, type Dirent } from 'node:fs';
import { readTaskLedgerPolicy, transitionEventExists } from '../task-ledger.ts';

export interface LegacyLedgerTaskFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly taskId: string;
  readonly status: string;
  readonly format: 'json' | 'markdown';
  readonly document: Record<string, unknown>;
  readonly rawText?: string;
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function collectTaskFileValues(value: unknown, files: Set<string>) {
  if (typeof value === 'string') {
    const normalized = normalizeRelativePath(value);
    if (normalized) files.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTaskFileValues(entry, files);
    }
  }
}

export function taskPathFor(cwd: string, taskId: string): string {
  const taskLedger = readTaskLedgerPolicy(cwd);
  return path.join(cwd, taskLedger.taskRoot, `${taskId}.json`);
}

export function safeTaskFileReadDir(directoryPath: string): readonly Dirent[] {
  try {
    return readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function safeTaskFileStat(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

export function readJsonRecord(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function legacyTaskRequiresBaseline(cwd: string, task: LegacyLedgerTaskFile): boolean {
  const originProvider = normalizeStringValue(task.document.originProvider ?? task.document.origin_provider);
  const originTaskId = normalizeStringValue(task.document.originTaskId ?? task.document.origin_task_id);
  const transitionRequired = task.status === 'done' || Boolean(originProvider || originTaskId);
  if (!transitionRequired) return false;
  const lastTransitionId = normalizeStringValue(task.document.lastTransitionId ?? task.document.last_transition_id);
  if (!lastTransitionId) return true;
  return !transitionEventExists(cwd, task.taskId, lastTransitionId);
}
