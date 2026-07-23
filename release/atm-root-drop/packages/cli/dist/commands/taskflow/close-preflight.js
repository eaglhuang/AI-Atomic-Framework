import { execFileSync } from 'node:child_process';
import { ATM_INDEX_FOREIGN_ACTIVE_STAGED } from '../git-index-ownership.js';
import { buildHistoricalClosePreflight, preflightBlockersToWriteReadinessBlockers } from './historical-close-preflight.js';
import { resolvePlanningPathFromStored } from '../planning-repo-root.js';
import { resolveTaskflowDeclaredFiles } from './task-scope.js';
import { quoteCliValue } from '../shared.js';
import { isPathAllowedByScope } from '../work-channels.js';
import { inspectTouchedPhysicalLineBudget } from '../git-governance/commit-scope-policy.js';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function extractTaskStringList(taskDocument, key) {
    const value = taskDocument[key];
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '').filter(Boolean)
        : [];
}
function normalizeTaskflowAuthority(taskDocument) {
    return String(taskDocument.closureAuthority ?? taskDocument.closure_authority ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
}
function sourcePlanPathOf(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const planPath = source.planPath;
    return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}
function taskflowPathMatches(filePath, declaredPath) {
    return isPathAllowedByScope(filePath, [declaredPath]);
}
function resolvePlanningPath(cwd, planningMirrorPath) {
    return resolvePlanningPathFromStored(cwd, planningMirrorPath);
}
export function extractTaskflowDeclaredFiles(cwd, taskId, taskDocument) {
    const runtimeResolved = [...resolveTaskflowDeclaredFiles(cwd, taskId, taskDocument)];
    const explicit = extractTaskStringList(taskDocument, 'deliverables');
    const deliverables = explicit.length > 0
        ? explicit
        : extractTaskStringList(taskDocument, 'scopePaths').filter((value) => value && !value.startsWith('.atm/') && !/[\\/]$/.test(value));
    return uniqueSorted(runtimeResolved.concat([
        ...extractTaskStringList(taskDocument, 'scopePaths'),
        ...deliverables,
        ...extractTaskStringList(taskDocument, 'targetAllowedFiles')
    ].filter((file) => !file.startsWith('.atm/'))));
}
export function inspectPlanningAuthorityDelivery(input) {
    if (normalizeTaskflowAuthority(input.taskDocument) !== 'planning_repo') {
        return { required: false, ok: false, repoRoot: null, matchedFiles: [], reason: null };
    }
    const planPath = input.resolvedPlanningMirrorPath ?? sourcePlanPathOf(input.taskDocument);
    const planning = resolvePlanningPath(input.cwd, planPath);
    if (!planning.repoRoot) {
        return { required: true, ok: false, repoRoot: null, matchedFiles: [], reason: planning.reason ?? 'planning repo could not be resolved' };
    }
    if (input.historicalDeliveryRefs.length === 0) {
        return { required: true, ok: false, repoRoot: planning.repoRoot, matchedFiles: [], reason: 'planning authority close requires --historical-delivery <planning-repo-commit>' };
    }
    const planningMirrorFile = planning.relativePath?.replace(/\\/g, '/') ?? null;
    const declaredFiles = extractTaskflowDeclaredFiles(input.cwd, String(input.taskDocument.workItemId ?? input.taskDocument.taskId ?? ''), input.taskDocument)
        .filter((entry) => entry.replace(/\\/g, '/') !== planningMirrorFile);
    const matchedFiles = [];
    for (const ref of input.historicalDeliveryRefs) {
        let commitSha = null;
        try {
            commitSha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
                cwd: planning.repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            }).trim() || null;
        }
        catch {
            commitSha = null;
        }
        if (!commitSha)
            continue;
        let changedFiles = '';
        try {
            changedFiles = execFileSync('git', ['show', '--pretty=format:', '--name-only', commitSha, '--'], {
                cwd: planning.repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
        }
        catch {
            changedFiles = '';
        }
        for (const file of changedFiles.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
            if (declaredFiles.some((declared) => taskflowPathMatches(file, declared))) {
                matchedFiles.push(file.replace(/\\/g, '/'));
            }
        }
    }
    const uniqueMatched = uniqueSorted(matchedFiles);
    return {
        required: true,
        ok: uniqueMatched.length > 0,
        repoRoot: planning.repoRoot,
        matchedFiles: uniqueMatched,
        reason: uniqueMatched.length > 0 ? null : 'planning delivery commit does not contain declared deliverable files'
    };
}
export function buildTaskflowClosePreflight(input) {
    const summary = buildHistoricalClosePreflight({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId || '<actor>',
        taskDocument: input.taskDocument,
        previewCommitBundle: input.previewCommitBundle,
        historicalDeliveryRefs: input.historicalDeliveryRefs,
        waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery,
        waiverReason: input.waiverReason
    });
    if (summary.unexpectedStagedTasks.length > 0
        && !summary.blockers.some((entry) => entry.id === 'unexpectedStagedTasks')) {
        const files = [...new Set(summary.unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles))];
        const taskIds = summary.unexpectedStagedTasks.map((entry) => entry.taskId);
        return {
            ...summary,
            ok: false,
            blockers: [
                {
                    id: 'unexpectedStagedTasks',
                    code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
                    summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
                    files,
                    taskIds,
                    remediationChoices: summary.unexpectedStagedTasks.map((entry) => ({
                        id: 'defer-foreign-staged',
                        summary: entry.restoreChoice,
                        requiredCommand: entry.deferCommand
                    })),
                    requiredCommand: summary.unexpectedStagedTasks[0]?.deferCommand ?? null
                },
                ...summary.blockers
            ],
            operationalBlockers: [
                {
                    id: 'unexpectedStagedTasks',
                    code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
                    summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
                    files,
                    taskIds,
                    remediationChoices: summary.unexpectedStagedTasks.map((entry) => ({
                        id: 'defer-foreign-staged',
                        summary: entry.restoreChoice,
                        requiredCommand: entry.deferCommand
                    })),
                    requiredCommand: summary.unexpectedStagedTasks[0]?.deferCommand ?? null
                },
                ...summary.operationalBlockers
            ]
        };
    }
    // Pre-close must not fail closed on another active task's oversized dirty WIP.
    // Foreign active dirty files stay advisory; line-budget admission only scans the
    // current task's touched source set (worktree porcelain minus foreign-active).
    const lineBudgetTouchedFiles = selectPreCloseLineBudgetTouchedFiles({
        cwd: input.cwd,
        foreignActiveDirtyFiles: summary.dirtyGuard.foreignActiveDirtyFiles ?? []
    });
    const lineBudgetReport = inspectTouchedPhysicalLineBudget(input.cwd, lineBudgetTouchedFiles, {
        taskId: input.taskId,
        actorId: input.actorId,
        gate: 'pre-close'
    });
    if (!lineBudgetReport.ok) {
        return {
            ...summary,
            ok: false,
            blockers: [
                {
                    id: 'staleEvidence',
                    code: 'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
                    summary: `Touched files exceed the physical line budget (${lineBudgetReport.maxLines}).`,
                    files: lineBudgetReport.hardViolations.map((entry) => entry.file),
                    taskIds: [input.taskId],
                    remediationChoices: [],
                    requiredCommand: lineBudgetReport.reproduceCommand
                },
                ...summary.blockers
            ],
            operationalBlockers: [
                {
                    id: 'staleEvidence',
                    code: 'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
                    summary: `Touched files exceed the physical line budget (${lineBudgetReport.maxLines}).`,
                    files: lineBudgetReport.hardViolations.map((entry) => entry.file),
                    taskIds: [input.taskId],
                    remediationChoices: [],
                    requiredCommand: lineBudgetReport.reproduceCommand
                },
                ...summary.operationalBlockers
            ]
        };
    }
    return summary;
}
function readTouchedFiles(cwd) {
    const output = execFileSync('git', ['status', '--porcelain', '-uall'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return output
        .split(/\r?\n/)
        .map((line) => line.slice(2).trim())
        .filter(Boolean)
        .map((file) => file.includes(' -> ') ? file.split(' -> ').pop() ?? file : file)
        .map((file) => file.replace(/\\/g, '/'));
}
export function selectPreCloseLineBudgetTouchedFiles(input) {
    const foreign = new Set((input.foreignActiveDirtyFiles ?? [])
        .map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter(Boolean));
    const readTouched = input.readTouched ?? readTouchedFiles;
    return readTouched(input.cwd)
        .map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter((file) => file.length > 0 && !foreign.has(file));
}
export function buildPlanningDeliveryRequiredCommand(taskId, actorId) {
    return `node atm.mjs taskflow close --task ${taskId} --actor ${quoteCliValue(actorId || '<actor>')} --historical-delivery <commit> --write --json`;
}
export { preflightBlockersToWriteReadinessBlockers };
