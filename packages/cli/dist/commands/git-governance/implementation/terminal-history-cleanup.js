import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeRelativePath } from '../commit-scope-policy.js';
import { readTaskWriteAuthority, resolveTaskHistoryOwnerTaskId, } from '../../../_vendor/core/dist/broker/cross-task-mutation-guard.js';
import { isDurableEvidencePath } from '../../../_vendor/core/dist/evidence/evidence-ledger.js';
function isCurrentTaskIntrinsicHistoryScope(scope, taskId) {
    const normalized = normalizeRelativePath(scope).toLowerCase();
    const task = taskId.toLowerCase();
    return normalized === `.atm/history/tasks/${task}.json`
        || (normalized.startsWith(`.atm/history/evidence/${task}.`) && isDurableEvidencePath(normalized))
        || normalized.startsWith(`.atm/history/task-events/${task}/`);
}
function isCurrentTaskPlanningMetadataScope(scope, planningSourcePath) {
    const expected = normalizeRelativePath(planningSourcePath ?? '');
    return Boolean(expected) && normalizeRelativePath(scope) === expected;
}
export function isExplicitTerminalHistoryCleanupArtifact(cwd, filePath, currentTaskId, declaredScope, isCurrentTaskGovernanceArtifact, currentTaskPlanningSourcePath = null) {
    const normalized = normalizeRelativePath(filePath);
    const current = String(currentTaskId ?? '').trim().toUpperCase();
    const ownerTaskId = resolveTaskHistoryOwnerTaskId(cwd, normalized);
    if (!ownerTaskId || ownerTaskId === current)
        return false;
    if (!/^\.atm\/history\/evidence\/[^/]+\.json$/i.test(normalized))
        return false;
    if (/\.(?:closure-packet|bundle-manifest|seal-and-commit|publication-input-manifest|publication-preflight)\.json$/i.test(normalized))
        return false;
    if (!declaredScope.some((scope) => normalizeRelativePath(scope) === normalized))
        return false;
    const historyOnlyScope = declaredScope.every((scope) => {
        const candidate = normalizeRelativePath(scope);
        return Boolean(candidate) && (isCurrentTaskIntrinsicHistoryScope(candidate, current)
            || isCurrentTaskPlanningMetadataScope(candidate, currentTaskPlanningSourcePath)
            || (!/[*?]/.test(candidate)
                && !/[\\/]$/.test(candidate)
                && (isCurrentTaskGovernanceArtifact(candidate) || /^\.atm\/history\/evidence\/[^/]+\.json$/i.test(candidate))));
    });
    if (!historyOnlyScope || readTaskWriteAuthority(cwd, ownerTaskId) !== 'terminal')
        return false;
    try {
        const evidence = JSON.parse(readFileSync(path.join(cwd, normalized), 'utf8'));
        return typeof evidence.taskId === 'string' && evidence.taskId.trim().toUpperCase() === ownerTaskId;
    }
    catch {
        return false;
    }
}
