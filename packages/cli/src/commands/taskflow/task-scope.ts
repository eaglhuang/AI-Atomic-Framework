import path from 'node:path';
import { sanitizeTaskDirectionAllowedFiles, getCanonicalAllowedFilesForTask } from '../task-direction.ts';
import { relativePathFrom } from '../shared.ts';
import { normalizeRelativePath } from '../tasks/task-file-io-helpers.ts';

function extractTaskStringList(taskDocument: Record<string, unknown>, key: string): string[] {
  const value = taskDocument[key];
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
    : [];
}

function normalizeTaskScopePaths(cwd: string, values: readonly string[]): readonly string[] {
  return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) return '';
    return path.isAbsolute(normalized)
      ? normalizeRelativePath(relativePathFrom(cwd, normalized))
      : normalized;
  }));
}

function extractRuntimeScopeFiles(taskDocument: Record<string, unknown>, cwd: string, taskId: string): readonly string[] {
  const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
    ? taskDocument.taskDirectionLock as Record<string, unknown>
    : {};
  const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
    ? taskDocument.claim as Record<string, unknown>
    : {};
  const lockAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId) ?? [];
  return normalizeTaskScopePaths(cwd, [
    ...lockAllowedFiles,
    ...extractTaskStringList(taskDirectionLock, 'allowedFiles'),
    ...extractTaskStringList(claim, 'files')
  ]);
}

export function resolveTaskflowDeclaredFiles(cwd: string, taskId: string, taskDocument: Record<string, unknown>): readonly string[] {
  return normalizeTaskScopePaths(cwd, [
    ...extractTaskStringList(taskDocument, 'deliverables'),
    ...extractTaskStringList(taskDocument, 'scopePaths'),
    ...extractTaskStringList(taskDocument, 'targetAllowedFiles'),
    ...extractRuntimeScopeFiles(taskDocument, cwd, taskId)
  ]);
}

export function resolveTaskflowEffectiveDeliverables(cwd: string, taskId: string, taskDocument: Record<string, unknown>): readonly string[] {
  return normalizeTaskScopePaths(cwd, [
    ...extractTaskStringList(taskDocument, 'deliverables'),
    ...extractTaskStringList(taskDocument, 'targetAllowedFiles'),
    ...extractRuntimeScopeFiles(taskDocument, cwd, taskId)
  ]).filter((entry) => !entry.startsWith('.atm/'));
}
