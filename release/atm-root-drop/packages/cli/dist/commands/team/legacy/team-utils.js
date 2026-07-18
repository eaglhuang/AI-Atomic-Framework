import path from 'node:path';
import { validateStrictPathHeuristic } from '../../tasks/task-import-validators.js';
import { normalizeRepoAbsoluteLeasePath, normalizeTeamLeasePath, normalizeTaskWriteScope } from './permission-lease-policy.js';
export function summarizeTask(taskId, task) {
    return {
        taskId,
        title: task?.title ?? task?.workItemId ?? taskId,
        status: task?.status ?? null,
        targetRepo: task?.targetRepo ?? null,
        sourcePlanPath: task?.source?.planPath ?? task?.sourcePlanPath ?? null
    };
}
export function readOptionValue(argv, flag) {
    const index = argv.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    return argv[index + 1];
}
export function deriveWritePaths(task, repoRoot) {
    return deriveTeamWriteScope(task, repoRoot).writePaths;
}
export function deriveTeamWriteScope(task, repoRoot) {
    const explicitAllowed = normalizeTaskPathArray(task?.targetAllowedFiles, repoRoot);
    if (explicitAllowed.length > 0) {
        return {
            writePaths: normalizeTaskWriteScope(explicitAllowed, repoRoot),
            planningReadOnlyPaths: [],
            allowEmptyWriteScope: false
        };
    }
    const rawCandidates = [
        ...normalizeStringArray(task?.deliverables),
        ...normalizeStringArray(task?.scopePaths)
    ];
    const candidates = normalizeTargetWritePathArray(rawCandidates, repoRoot);
    const planningReadOnlyPaths = collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates);
    const writePaths = uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
        return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
    }));
    return {
        writePaths,
        planningReadOnlyPaths,
        allowEmptyWriteScope: writePaths.length === 0 && planningReadOnlyPaths.length > 0
    };
}
function collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates) {
    const planningRepo = String(task?.planningRepo ?? '').trim();
    if (!planningRepo)
        return [];
    const planningRoot = path.isAbsolute(planningRepo)
        ? path.resolve(planningRepo)
        : (repoRoot ? path.resolve(repoRoot, planningRepo) : '');
    if (!planningRoot)
        return [];
    return uniqueStrings(rawCandidates.map((entry) => normalizeAbsolutePathUnderRoot(entry, planningRoot)).filter(Boolean));
}
function normalizeAbsolutePathUnderRoot(rawPath, rootPath) {
    const raw = String(rawPath).trim();
    if (!raw || !path.isAbsolute(raw))
        return '';
    const candidate = path.resolve(raw);
    const relative = path.relative(path.resolve(rootPath), candidate);
    if (!relative || relative === '')
        return '';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return '';
    return relative.replace(/\\/g, '/');
}
export function normalizeTargetWritePathArray(paths, repoRoot) {
    return paths
        .map((entry) => normalizeTargetWritePath(entry, repoRoot))
        .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}
function normalizeTargetWritePath(rawPath, repoRoot) {
    const raw = String(rawPath).trim();
    if (!raw)
        return '';
    const normalizedRaw = raw.replace(/\\/g, '/');
    if ((normalizedRaw.startsWith('/') || /^[A-Za-z]:\//.test(normalizedRaw)) && normalizeRepoAbsoluteLeasePath(raw, repoRoot) === null) {
        return '';
    }
    return normalizeTeamLeasePath(raw, repoRoot);
}
export function collectTaskPathHints(task) {
    return uniqueStrings([
        ...normalizeTaskPathArray(task?.targetAllowedFiles),
        ...normalizeTaskPathArray(task?.deliverables),
        ...normalizeTaskPathArray(task?.scopePaths)
    ]);
}
export function normalizeTaskPathArray(value, repoRoot) {
    return normalizeStringArray(value)
        .map((entry) => normalizeTeamLeasePath(entry, repoRoot))
        .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}
export function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
export function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
