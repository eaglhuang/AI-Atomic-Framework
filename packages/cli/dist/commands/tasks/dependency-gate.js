import { existsSync, readFileSync } from 'node:fs';
import { deriveAtmScopeClass } from '../../../../core/dist/broker/atm-core-scope.js';
import { taskPathFor } from './task-file-io-helpers.js';
import { parseYamlList } from './task-import-validators.js';
import { normalizeWorkItemStatus } from './task-transition-helpers.js';
import { buildDependencyCloseoutBlocker, verifyCloseoutProvenance } from './closeout-provenance.js';
function readTaskDocument(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function declaredDependenciesFor(taskDocument) {
    return Array.from(new Set(parseYamlList(taskDocument.dependencies ?? taskDocument.depends_on ?? taskDocument.blocked_by)));
}
function isDependencyStatusClosed(status) {
    const normalized = normalizeWorkItemStatus(status);
    return normalized === 'done' || normalized === 'verified';
}
export function findTaskClaimDependencyBlockers(cwd, taskId, taskDocument, options = {}) {
    const declaredDependencies = declaredDependenciesFor(taskDocument);
    if (declaredDependencies.length === 0) {
        return [];
    }
    const scopeClass = deriveAtmScopeClass(options.claimFiles ?? []);
    if (options.claimFiles && options.claimFiles.length > 0 && !scopeClass.hasCode) {
        return [];
    }
    const codeFilesBlocked = scopeClass.classifications
        .filter((classification) => classification.scopeClass.includes('code'))
        .map((classification) => classification.path);
    const blockers = [];
    const enrichBlocker = (blocker) => ({
        ...blocker,
        blockedByDependency: true,
        dependencyTaskIds: declaredDependencies,
        scopeClass,
        codeFilesBlocked,
        allowedDependencyBlockedRoute: 'docs-ledger-planning'
    });
    for (const dependencyTaskId of declaredDependencies) {
        if (dependencyTaskId === taskId) {
            continue;
        }
        const dependencyPath = taskPathFor(cwd, dependencyTaskId);
        if (!existsSync(dependencyPath)) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: 'missing', taskPath: dependencyPath }));
            continue;
        }
        const dependencyDocument = readTaskDocument(dependencyPath);
        if (!dependencyDocument) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: 'unreadable', taskPath: dependencyPath }));
            continue;
        }
        const dependencyStatus = normalizeWorkItemStatus(dependencyDocument.status);
        if (!isDependencyStatusClosed(dependencyStatus)) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: dependencyStatus, taskPath: dependencyPath }));
            continue;
        }
        if (!verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument)) {
            blockers.push(enrichBlocker(buildDependencyCloseoutBlocker(cwd, dependencyTaskId, dependencyPath, dependencyDocument)));
        }
    }
    return blockers;
}
export function areTaskDependenciesSatisfied(task, statusById, cwd = process.cwd()) {
    return task.dependencies.every((dependencyTaskId) => {
        const status = statusById.get(dependencyTaskId);
        if (status !== 'done' && status !== 'verified') {
            return false;
        }
        const dependencyPath = taskPathFor(cwd, dependencyTaskId);
        if (!existsSync(dependencyPath)) {
            return false;
        }
        const dependencyDocument = readTaskDocument(dependencyPath);
        return Boolean(dependencyDocument
            && isDependencyStatusClosed(dependencyDocument.status)
            && verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument));
    });
}
