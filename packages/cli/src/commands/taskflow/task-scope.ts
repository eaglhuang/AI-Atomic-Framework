import path from 'node:path';
import { sanitizeTaskDirectionAllowedFiles, getCanonicalAllowedFilesForTask } from '../task-direction.ts';
import { resolveStoredPlanningPath } from '../planning-repo-root.ts';
import { relativePathFrom } from '../shared.ts';
import { normalizeRelativePath } from '../tasks/task-file-io-helpers.ts';
import { normalizeMarkdownPathDeclaration } from './markdown-paths.ts';

function extractTaskStringList(taskDocument: Record<string, unknown>, key: string): string[] {
  const value = taskDocument[key];
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? normalizeMarkdownPathDeclaration(entry) : '').filter(Boolean)
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

function sourcePlanPathOf(taskDocument: Record<string, unknown>): string | null {
  const source = taskDocument.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const planPath = (source as Record<string, unknown>).planPath;
  return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}

function extractPlanningScopedFiles(taskDocument: Record<string, unknown>, cwd: string): readonly string[] {
  const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
    ? taskDocument.taskDirectionLock as Record<string, unknown>
    : {};
  return normalizeTaskScopePaths(cwd, [
    sourcePlanPathOf(taskDocument) ?? '',
    ...extractTaskStringList(taskDirectionLock, 'planningReadOnlyPaths'),
    ...extractTaskStringList(taskDirectionLock, 'planningMirrorPaths'),
    ...extractTaskStringList(taskDocument, 'planningReadOnlyPaths'),
    ...extractTaskStringList(taskDocument, 'planningMirrorPaths')
  ]);
}

function isPlanningScopedPath(cwd: string, filePath: string, planningScopedFiles: readonly string[]): boolean {
  if (planningScopedFiles.includes(filePath)) return true;
  if (filePath.endsWith('.task.md')) return true;
  return resolveStoredPlanningPath(cwd, filePath).isExternalPlanning;
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
  const planningScopedFiles = extractPlanningScopedFiles(taskDocument, cwd);
  const declaredTargetFiles = normalizeTaskScopePaths(cwd, [
    ...extractTaskStringList(taskDocument, 'deliverables'),
    ...extractTaskStringList(taskDocument, 'scopePaths'),
    ...extractTaskStringList(taskDocument, 'targetAllowedFiles')
  ]);
  const runtimeTargetFiles = extractRuntimeScopeFiles(taskDocument, cwd, taskId)
    .filter((entry) => !isPlanningScopedPath(cwd, entry, planningScopedFiles));
  return normalizeTaskScopePaths(cwd, [...declaredTargetFiles, ...runtimeTargetFiles]);
}

export function resolveTaskflowEffectiveDeliverables(cwd: string, taskId: string, taskDocument: Record<string, unknown>): readonly string[] {
  const planningScopedFiles = extractPlanningScopedFiles(taskDocument, cwd);
  const declaredTargetFiles = normalizeTaskScopePaths(cwd, [
    ...extractTaskStringList(taskDocument, 'deliverables'),
    ...extractTaskStringList(taskDocument, 'targetAllowedFiles')
  ]);
  const runtimeTargetFiles = extractRuntimeScopeFiles(taskDocument, cwd, taskId)
    .filter((entry) => !isPlanningScopedPath(cwd, entry, planningScopedFiles));
  return normalizeTaskScopePaths(cwd, [...declaredTargetFiles, ...runtimeTargetFiles])
    .filter((entry) => !entry.startsWith('.atm/'));
}
