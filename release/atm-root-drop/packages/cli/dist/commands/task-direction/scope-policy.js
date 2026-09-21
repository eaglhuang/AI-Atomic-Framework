import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isExternalPlanningStoredPath, normalizeStoredPlanningPathForIdentity, resolveStoredPlanningPath } from '../planning-repo-root.js';
import { isPathAllowedByScope } from '../work-channels.js';
import { derivePlanningMirrorGuardPaths, isExternalPlanningPath, isPlanningMirrorPath, isTaskDirectionLock, normalizeRelativePath, sanitizeTaskDirectionAllowedFiles, uniqueSorted } from './support.js';
export function getCanonicalAllowedFilesForTask(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    if (existsSync(lockPath)) {
        try {
            const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
            const released = parsed.released === true || parsed.status === 'released';
            if (!released && isTaskDirectionLock(parsed.taskDirectionLock))
                return parsed.taskDirectionLock.allowedFiles;
        }
        catch { /* Fall through to sidecar. */ }
    }
    const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
    if (existsSync(sidecarPath)) {
        try {
            const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8'));
            if (isTaskDirectionLock(parsed))
                return parsed.allowedFiles;
        }
        catch { /* Ignore malformed runtime files. */ }
    }
    return null;
}
export function diagnoseTaskDirectionLockAllowedFiles(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    let canonicalAllowedFiles = null;
    let governanceLockFiles = null;
    let hasGovernanceLock = false;
    if (existsSync(lockPath)) {
        try {
            const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
            if (parsed.released !== true && parsed.status !== 'released') {
                hasGovernanceLock = true;
                if (isTaskDirectionLock(parsed.taskDirectionLock))
                    canonicalAllowedFiles = parsed.taskDirectionLock.allowedFiles;
                if (Array.isArray(parsed.files))
                    governanceLockFiles = uniqueSorted(parsed.files.filter((entry) => typeof entry === 'string').map(normalizeRelativePath));
            }
        }
        catch { /* Ignore malformed runtime files. */ }
    }
    if (!canonicalAllowedFiles)
        canonicalAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId);
    let claimFiles = null;
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (existsSync(taskPath)) {
        try {
            const claim = JSON.parse(readFileSync(taskPath, 'utf8')).claim;
            if (Array.isArray(claim?.files))
                claimFiles = uniqueSorted(claim.files.filter((entry) => typeof entry === 'string').map(normalizeRelativePath));
        }
        catch { /* Ignore malformed ledger files. */ }
    }
    const mismatches = [];
    for (const [source, files] of [['governance-lock-files', governanceLockFiles], ['claim-files', claimFiles]]) {
        if (!canonicalAllowedFiles || !files)
            continue;
        const drift = computeAllowedFilesDrift(canonicalAllowedFiles, files);
        if (drift.missingFromSource.length || drift.extraInSource.length)
            mismatches.push({ source, ...drift });
    }
    return { taskId, hasGovernanceLock, canonicalAllowedFiles, governanceLockFiles, claimFiles, mismatches };
}
function computeAllowedFilesDrift(canonical, source) {
    const canonicalSet = new Set(canonical.map((value) => normalizeRelativePath(value).toLowerCase()));
    const sourceSet = new Set(source.map((value) => normalizeRelativePath(value).toLowerCase()));
    return {
        missingFromSource: [...canonicalSet].filter((value) => !sourceSet.has(value)).sort(),
        extraInSource: [...sourceSet].filter((value) => !canonicalSet.has(value)).sort()
    };
}
export function buildAllowedFilesForTask(task) {
    return partitionTaskScope(task).targetWork.allowedFiles;
}
export function buildTaskSelfAllowPaths(taskId) {
    return [`.atm/history/tasks/${taskId}.json`, `.atm/history/evidence/${taskId}.*`, `.atm/history/task-events/${taskId}/**`];
}
export function partitionTaskScope(task, options) {
    const cwd = options?.cwd ?? null;
    const normalizeScopePath = (value) => !value ? value : cwd ? normalizeStoredPlanningPathForIdentity(cwd, value) : normalizeRelativePath(value);
    const isPlanningPath = (value) => value ? (cwd ? isExternalPlanningStoredPath(cwd, value) : isExternalPlanningPath(value)) : false;
    const resolveAbsolute = (value) => !value ? '' : cwd ? resolveStoredPlanningPath(cwd, value).absolutePath : path.resolve(value);
    // Planning context may live outside the target repository.  These paths are
    // read-only guard inputs, not target-work write grants, so preserving their
    // resolved absolute form is required to derive a local mirror guard.
    const planningReadOnlyPaths = uniqueSorted([
        task.sourcePlanPath ?? '', ...task.nearbyPlanPaths, ...task.scopePaths.filter(isPlanningPath)
    ].map(resolveAbsolute).filter(Boolean));
    const planningMirrorPaths = uniqueSorted(planningReadOnlyPaths.flatMap(derivePlanningMirrorGuardPaths));
    const targetCandidates = sanitizeTaskDirectionAllowedFiles(task.scopePaths.map(normalizeScopePath));
    const allowedFiles = targetCandidates.filter((entry) => !planningReadOnlyPaths.includes(entry)
        && (task.allowPlanningMirror || !isPlanningMirrorPath(entry, planningMirrorPaths))
        && !(task.outOfScope && isPathAllowedByScope(entry, task.outOfScope)));
    if (task.outOfScope?.length) {
        const intersections = targetCandidates.filter((entry) => isPathAllowedByScope(entry, task.outOfScope));
        if (intersections.length)
            console.warn(`[ATM-WARNING] Task ${task.workItemId} scope paths intersect with outOfScope: ${intersections.join(', ')}. These files are subtracted from targetAllowedFiles.`);
    }
    return { planningContext: { readOnlyPaths: planningReadOnlyPaths }, targetWork: { allowedFiles, planningMirrorPaths, allowPlanningMirror: task.allowPlanningMirror } };
}
