import path from 'node:path';
import { sanitizeTaskDirectionAllowedFiles, getCanonicalAllowedFilesForTask } from '../task-direction.js';
import { resolveStoredPlanningPath } from '../planning-repo-root.js';
import { relativePathFrom } from '../shared.js';
import { normalizeRelativePath } from '../tasks/task-file-io-helpers.js';
import { normalizeMarkdownPathDeclaration } from './markdown-paths.js';
function extractTaskStringList(taskDocument, key) {
    const value = taskDocument[key];
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? normalizeMarkdownPathDeclaration(entry) : '').filter(Boolean)
        : [];
}
function normalizeTaskScopePaths(cwd, values) {
    return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
        const normalized = normalizeRelativePath(entry);
        if (!normalized)
            return '';
        return path.isAbsolute(normalized)
            ? normalizeRelativePath(relativePathFrom(cwd, normalized))
            : normalized;
    }));
}
function sourcePlanPathOf(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const planPath = source.planPath;
    return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}
function extractPlanningScopedFiles(taskDocument, cwd) {
    const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
        ? taskDocument.taskDirectionLock
        : {};
    return normalizeTaskScopePaths(cwd, [
        sourcePlanPathOf(taskDocument) ?? '',
        ...extractTaskStringList(taskDirectionLock, 'planningReadOnlyPaths'),
        ...extractTaskStringList(taskDirectionLock, 'planningMirrorPaths'),
        ...extractTaskStringList(taskDocument, 'planningReadOnlyPaths'),
        ...extractTaskStringList(taskDocument, 'planningMirrorPaths')
    ]);
}
function isPlanningScopedPath(cwd, filePath, planningScopedFiles) {
    if (planningScopedFiles.includes(filePath))
        return true;
    if (filePath.endsWith('.task.md'))
        return true;
    return resolveStoredPlanningPath(cwd, filePath).isExternalPlanning;
}
function extractRuntimeScopeFiles(taskDocument, cwd, taskId) {
    const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
        ? taskDocument.taskDirectionLock
        : {};
    const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : {};
    const lockAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId) ?? [];
    return normalizeTaskScopePaths(cwd, [
        ...lockAllowedFiles,
        ...extractTaskStringList(taskDirectionLock, 'allowedFiles'),
        ...extractTaskStringList(claim, 'files')
    ]);
}
export function resolveTaskflowDeclaredFiles(cwd, taskId, taskDocument) {
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
export function resolveTaskflowEffectiveDeliverables(cwd, taskId, taskDocument) {
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
