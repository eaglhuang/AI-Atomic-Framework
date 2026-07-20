// @ts-nocheck
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { compareScoredTasks, pathFieldMatches, looksLikeNamedPlanPrompt, countTokenOverlap } from '../match-and-sort.js';
import { CliError } from '../../shared.js';
import { extractPathLikeStringsFromPrompt, isPathAllowedByScope, listActiveBatchRuns } from '../../work-channels.js';
import { normalizeTaskRouteStatus, normalizeSearchText } from '../intent-normalizers.js';
import { hasRequiredPromptScopeMatch, isTaskCardSurfaceOnlyMatch } from '../route-predicates.js';
import { sha256, uniqueSorted } from '../view-projections.js';
import { isTaskPathUnderPreferredPlanningRoots } from './task-card-discovery.js';
export function resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution) {
    if (!taskIntent || !taskIntent.taskScopeMentioned)
        return null;
    if (taskIntent.explicitTaskIds.length > 0) {
        const selectedTasks = taskIntent.explicitTaskIds
            .map((taskId) => findTaskByTaskIdReference(tasks, taskId))
            .filter((task) => Boolean(task));
        const missingTaskIds = taskIntent.explicitTaskIds.filter((taskId) => !findTaskByTaskIdReference(selectedTasks, taskId));
        if (missingTaskIds.length > 0) {
            return {
                status: 'not-found',
                selectedTasks,
                targetRepo: resolveRouteTargetRepo(selectedTasks),
                diagnostics: ['explicit-task-range-missing-task-ids', `missing:${missingTaskIds.join(',')}`]
            };
        }
        return {
            status: selectedTasks.length > 1 ? 'queue' : 'ready',
            selectedTasks,
            targetRepo: resolveRouteTargetRepo(selectedTasks),
            diagnostics: ['explicit-task-range']
        };
    }
    const handoffRoute = resolveHandoffResumeTaskRoute(cwd, tasks, taskIntent);
    if (handoffRoute)
        return handoffRoute;
    const scored = tasks
        .map((task) => scoreTaskForIntent(cwd, task, taskIntent))
        .filter((task) => (task.matchScore ?? 0) > 0)
        .sort(compareScoredTasks);
    const hasExplicitScopeHints = taskIntent.mentionedTaskIds.length > 0
        || taskIntent.mentionedPlanPaths.length > 0
        || taskIntent.taskRootHints.length > 0
        || taskIntent.targetRepoHints.length > 0;
    const viableMatches = hasExplicitScopeHints
        ? scored.filter((task) => hasRequiredPromptScopeMatch(task, taskIntent))
        : scored;
    if (viableMatches.length === 0) {
        if (taskIntent.queueRequested && !hasExplicitScopeHints && tasks.length > 0) {
            // ATM-BUG-2026-07-07-047: a blanket "all/open/remaining task cards"
            // prompt names no specific task, plan, or root, so nothing scores above
            // zero against keyword-based matching. ATM already discovered open
            // imported work in `tasks`; route the whole queue instead of
            // discarding it as task-scope-not-found.
            const scoped = applyOrdinalScope(tasks, taskIntent);
            return {
                status: 'queue',
                selectedTasks: scoped,
                targetRepo: resolveRouteTargetRepo(scoped),
                diagnostics: ['queue-requested-fallback-to-full-open-queue', `scoped-queue-size:${scoped.length}`]
            };
        }
        if (taskIntent.taskRootHints.some((hint) => hint.startsWith('TASK-'))
            && (taskIntent.mentionedTaskIds.length === 0
                && taskIntent.mentionedPlanPaths.length === 0
                && taskIntent.taskRootHints.length > 0
                && (taskIntent.queueRequested || taskIntent.ordinalScope !== null || taskIntent.requestedAction === 'close'))) {
            return {
                status: 'empty',
                selectedTasks: [],
                targetRepo: null,
                diagnostics: ['prompt-task-scope-had-no-open-imported-work']
            };
        }
        return {
            status: 'not-found',
            selectedTasks: [],
            targetRepo: null,
            diagnostics: ['prompt-task-scope-had-no-matching-task-card']
        };
    }
    if (viableMatches.every(isTaskCardSurfaceOnlyMatch)) {
        if (looksLikeNamedPlanPrompt(taskIntent.userPrompt ?? '')) {
            return {
                status: 'not-found',
                selectedTasks: [],
                targetRepo: null,
                diagnostics: ['low-confidence-task-card-surface-rejected', 'named-plan-prompt-had-no-matching-plan-tasks']
            };
        }
        return {
            status: 'ambiguous',
            selectedTasks: viableMatches.slice(0, 12),
            targetRepo: resolveRouteTargetRepo(viableMatches),
            diagnostics: ['low-confidence-task-card-surface-selection-required']
        };
    }
    const scoped = applyOrdinalScope(viableMatches, taskIntent);
    const selectedTasks = taskIntent.queueRequested || taskIntent.ordinalScope ? scoped : scoped.slice(0, 1);
    if (taskIntent.queueRequested || taskIntent.ordinalScope) {
        return {
            status: 'queue',
            selectedTasks,
            targetRepo: resolveRouteTargetRepo(selectedTasks),
            diagnostics: [`scoped-queue-size:${selectedTasks.length}`]
        };
    }
    const bestScore = viableMatches[0]?.matchScore ?? 0;
    const topMatches = viableMatches.filter((task) => (task.matchScore ?? 0) === bestScore);
    const exactTaskIdRequested = taskIntent.mentionedTaskIds.length > 0;
    if (topMatches.length === 1 && (exactTaskIdRequested || bestScore >= 60)) {
        return {
            status: 'ready',
            selectedTasks: [topMatches[0]],
            targetRepo: topMatches[0].targetRepo,
            diagnostics: topMatches[0].matchReasons ?? []
        };
    }
    return {
        status: 'ambiguous',
        selectedTasks: viableMatches.slice(0, 12),
        targetRepo: resolveRouteTargetRepo(viableMatches),
        diagnostics: ['multiple-task-candidates-matched-prompt']
    };
}
/**
 * Handoff documents are workspace-level artifacts rather than task cards, so
 * their filename cannot score against a ledger task path. When a handoff is
 * explicitly named, use the handoff's task references only as a constrained
 * hint: a referenced active claim is safe, a stale reference is not, and an
 * unqualified handoff may fall back only when exactly one active claim exists.
 */
export function resolveHandoffResumeTaskRoute(cwd, tasks, taskIntent) {
    if (!taskIntent?.userPrompt || !isHandoffPrompt(taskIntent.userPrompt))
        return null;
    const handoffPath = resolvePromptHandoffPath(cwd, taskIntent.userPrompt);
    if (!handoffPath)
        return null;
    const activeTasks = tasks.filter(isActiveClaimedTask);
    if (activeTasks.length === 0)
        return null;
    const handoffText = readFileText(handoffPath);
    const referencedTaskIds = handoffText ? extractTaskIdReferencesFromPrompt(handoffText) : [];
    if (referencedTaskIds.length > 0) {
        const referencedActiveTasks = activeTasks.filter((task) => referencedTaskIds.some((taskId) => expandTaskIdReferenceAliases(taskId).includes(task.workItemId.toUpperCase())));
        if (referencedActiveTasks.length === 1) {
            return {
                status: 'ready',
                selectedTasks: referencedActiveTasks,
                targetRepo: referencedActiveTasks[0]?.targetRepo ?? null,
                diagnostics: ['handoff-file-task-reference', 'handoff-file-active-claim-match']
            };
        }
        if (referencedActiveTasks.length > 1) {
            return {
                status: 'ambiguous',
                selectedTasks: referencedActiveTasks,
                targetRepo: resolveRouteTargetRepo(referencedActiveTasks),
                diagnostics: ['handoff-file-multiple-active-claim-matches']
            };
        }
        return {
            status: 'not-found',
            selectedTasks: [],
            targetRepo: null,
            diagnostics: ['handoff-file-references-no-active-claim']
        };
    }
    if (activeTasks.length === 1) {
        return {
            status: 'ready',
            selectedTasks: activeTasks,
            targetRepo: activeTasks[0]?.targetRepo ?? null,
            diagnostics: ['handoff-file-unique-active-claim-fallback']
        };
    }
    return {
        status: 'ambiguous',
        selectedTasks: activeTasks,
        targetRepo: resolveRouteTargetRepo(activeTasks),
        diagnostics: ['handoff-file-multiple-active-claims']
    };
}
export function isActiveClaimedTask(task) {
    return normalizeTaskRouteStatus(task.status) === 'running'
        && typeof task.activeClaimActorId === 'string'
        && task.activeClaimActorId.trim().length > 0;
}
export function isHandoffPrompt(prompt) {
    return /(?:handoff|unfinished[-_ ]work)\.md\b/i.test(prompt);
}
function resolvePromptHandoffPath(cwd, prompt) {
    const candidates = new Set();
    for (const match of prompt.matchAll(/[A-Za-z]:[^\s`"'<>]+\.md/gi)) {
        candidates.add(path.normalize(match[0].replace(/[),.;]+$/, '')));
    }
    for (const match of prompt.matchAll(/\b[A-Za-z0-9][A-Za-z0-9._-]*(?:handoff|unfinished[-_ ]work)[A-Za-z0-9._-]*\.md\b/gi)) {
        const basename = match[0];
        candidates.add(path.join(cwd, '.atm', 'history', 'handoff', basename));
    }
    for (const candidate of extractPathLikeStringsFromPrompt(prompt)) {
        if (/(?:handoff|unfinished[-_ ]work)\.md$/i.test(candidate)) {
            candidates.add(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate));
        }
    }
    return [...candidates].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}
function readFileText(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    }
    catch {
        return null;
    }
}
export function findTaskByTaskIdReference(tasks, taskIdReference) {
    const aliases = expandTaskIdReferenceAliases(taskIdReference);
    return tasks.find((task) => aliases.includes(task.workItemId.toUpperCase())) ?? null;
}
export function assertPromptBatchDoesNotConflict(input) {
    if (input.promptScope?.status !== 'queue')
        return;
    const requestedTaskIds = input.promptScope.selectedTasks.map((task) => task.workItemId);
    const requestedAllowedFiles = uniqueSorted(input.promptScope.selectedTasks.flatMap((task) => task.targetAllowedFiles));
    const sourcePromptHash = input.sourcePrompt?.trim() ? sha256(input.sourcePrompt.trim()) : null;
    const activeBatches = listActiveBatchRuns(input.cwd);
    for (const batchRun of activeBatches) {
        if (input.currentBatchId && batchRun.batchId === input.currentBatchId)
            continue;
        if (sourcePromptHash && batchRun.sourcePromptHash === sourcePromptHash)
            continue;
        const overlappingTaskIds = requestedTaskIds.filter((taskId) => batchRun.taskIds.includes(taskId));
        if (overlappingTaskIds.length > 0) {
            throw new CliError('ATM_BATCH_TASK_OWNERSHIP_CONFLICT', 'A task cannot belong to two active batch runs. Abandon or finish the existing batch before creating another one for the same task.', {
                exitCode: 1,
                details: {
                    batchId: batchRun.batchId,
                    scopeKey: batchRun.scopeKey,
                    overlappingTaskIds,
                    requiredCommand: `node atm.mjs batch status --batch ${batchRun.batchId} --json`
                }
            });
        }
        const batchTasks = batchRun.taskIds
            .map((taskId) => input.allTasks.find((task) => task.workItemId === taskId))
            .filter((task) => Boolean(task));
        const batchAllowedFiles = uniqueSorted(batchTasks.flatMap((task) => task.targetAllowedFiles));
        const overlappingFiles = requestedAllowedFiles.filter((file) => isPathAllowedByScope(file, batchAllowedFiles));
        if (overlappingFiles.length > 0) {
            throw new CliError('ATM_BATCH_FILE_CONFLICT', 'Another active batch already owns one or more target files for this batch range.', {
                exitCode: 1,
                details: {
                    conflictingBatchId: batchRun.batchId,
                    conflictingScopeKey: batchRun.scopeKey,
                    conflictingTaskIds: batchRun.taskIds,
                    overlappingFiles,
                    requiredAction: `Run node atm.mjs batch status --batch ${batchRun.batchId} --json, then checkpoint/commit or abandon that batch before claiming this overlapping range.`
                }
            });
        }
    }
}
export function scoreTaskForIntent(cwd, task, intent) {
    const prompt = normalizeSearchText(intent.userPrompt ?? '');
    const reasons = [];
    let score = 0;
    if (intent.mentionedTaskIds.includes(task.workItemId.toUpperCase())) {
        score += 120;
        reasons.push('task-id-exact');
    }
    else if (isTaskIdSuffixMentioned(task.workItemId, intent)) {
        score += 110;
        reasons.push('task-id-suffix-match');
    }
    const pathFields = [
        task.taskPath,
        task.sourcePlanPath,
        ...task.nearbyPlanPaths
    ].filter((entry) => Boolean(entry));
    for (const planHint of intent.mentionedPlanPaths) {
        if (pathFields.some((field) => pathFieldMatches(field, planHint))) {
            score += 90;
            reasons.push('plan-path-match');
            break;
        }
    }
    for (const field of pathFields) {
        const normalizedField = normalizeSearchText(field);
        const stem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
        if ((normalizedField && prompt.includes(normalizedField)) || (stem && prompt.includes(stem))) {
            score += 85;
            reasons.push('nearby-plan-name-match');
            break;
        }
    }
    for (const rootHint of intent.taskRootHints) {
        const normalizedHint = normalizeSearchText(rootHint);
        if (normalizedHint && (normalizeSearchText(task.workItemId).includes(normalizedHint)
            || pathFields.some((field) => normalizeSearchText(field).includes(normalizedHint)))) {
            score += 65;
            reasons.push('task-root-hint-match');
            break;
        }
    }
    if (intent.targetRepoHints.length > 0 && task.targetRepo) {
        const target = normalizeSearchText(task.targetRepo);
        if (intent.targetRepoHints.some((hint) => target.includes(normalizeSearchText(hint)))) {
            score += 35;
            reasons.push('target-repo-match');
        }
    }
    const normalizedTitle = normalizeSearchText(task.title);
    if (normalizedTitle && prompt.includes(normalizedTitle)) {
        score += 60;
        reasons.push('title-exact');
    }
    else {
        const overlap = countTokenOverlap(prompt, task.title);
        if (overlap >= 2) {
            score += Math.min(30, overlap * 8);
            reasons.push('title-token-overlap');
        }
    }
    if (/(?:\u4efb\u52d9\u5361|task\s*card)/i.test(intent.userPrompt ?? '') && /\.task\.md$/i.test(task.taskPath)) {
        score += 10;
        reasons.push('task-card-surface');
    }
    if (task.taskPath && isTaskPathUnderPreferredPlanningRoots(cwd, task.taskPath)) {
        score += 15;
        reasons.push('canonical-planning-root');
    }
    return {
        ...task,
        matchScore: score,
        matchReasons: reasons
    };
}
export function applyOrdinalScope(tasks, intent) {
    const planScoped = tasks.filter((task) => (task.matchReasons ?? []).some((reason) => reason.includes('plan') || reason.includes('root') || reason.includes('task-id')));
    const source = planScoped.length > 0 ? planScoped : tasks;
    if (!intent.ordinalScope)
        return source;
    return [...source]
        .sort((left, right) => left.workItemId.localeCompare(right.workItemId))
        .slice(0, intent.ordinalScope.count);
}
export function resolveRouteTargetRepo(tasks) {
    const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry) => Boolean(entry)));
    return targets.length === 1 ? targets[0] : null;
}
export function extractTaskRootHintsFromPrompt(prompt, mentionedTaskIds) {
    const directRoots = (prompt.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+\b/g) ?? [])
        .map((entry) => entry.toUpperCase())
        .filter((entry) => !/\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(entry));
    const derivedRoots = mentionedTaskIds
        .map((taskId) => taskId.match(/^(.*)-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/)?.[1] ?? null)
        .filter((entry) => Boolean(entry));
    return uniqueSorted([...directRoots, ...derivedRoots]);
}
export function extractTaskIdReferencesFromPrompt(prompt) {
    const references = new Set();
    for (const match of prompt.matchAll(/\b(?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/gi)) {
        const reference = match[0].toUpperCase();
        if (!isBacklogIdentifier(reference)) {
            references.add(reference);
        }
    }
    for (const match of prompt.matchAll(/\b((?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,})((?:\s*[\/,]\s*\d{2,})+)/gi)) {
        const prefix = match[1]?.toUpperCase();
        const firstNumber = match[2] ?? '';
        const suffix = match[3] ?? '';
        if (!prefix || !firstNumber)
            continue;
        for (const numberMatch of suffix.matchAll(/\d{2,}/g)) {
            const number = numberMatch[0]?.padStart(firstNumber.length, '0');
            if (number)
                references.add(`${prefix}-${number}`);
        }
    }
    return [...references].sort((left, right) => left.localeCompare(right));
}
export function isBacklogIdentifier(reference) {
    return /^(?:ATM|PROJECT)-BUG-\d{4}-\d{2}-\d{2}-\d{3}$/i.test(reference.trim());
}
export function expandTaskIdReferenceAliases(taskIdReference) {
    const normalized = taskIdReference
        .trim()
        .toUpperCase()
        .replace(/_/g, '-')
        .replace(/^[`"'(]+|[`"'):;,]+$/g, '');
    if (!normalized)
        return [];
    const aliases = new Set([normalized]);
    if (normalized.startsWith('TASK-')) {
        aliases.add(normalized.slice('TASK-'.length));
    }
    else if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(normalized)) {
        aliases.add(`TASK-${normalized}`);
    }
    return [...aliases];
}
export function extractTaskFamilyRootHintsFromPrompt(prompt) {
    const ignoredCodes = new Set(['AI', 'API', 'ATM', 'CLI', 'CPU', 'CSS', 'GIT', 'HTML', 'HTTP', 'JSON', 'MD', 'NPM', 'SDK', 'TASK', 'TS', 'UI']);
    const output = new Set();
    for (const match of prompt.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)) {
        const code = match[1]?.toUpperCase();
        if (!code || ignoredCodes.has(code))
            continue;
        const index = match.index ?? 0;
        const context = prompt.slice(Math.max(0, index - 30), Math.min(prompt.length, index + code.length + 40));
        if (/(?:\u7cfb\u5217|\u4efb\u52d9\u5361|\u4efb\u52d9|\u5f8c\u9762|\u5f8c\u7e8c|\u5269\u9918|\u63a5\u4e0b\u4f86|\u9010\u4e00|task\s*cards?|tasks?|task\s*family|family|remaining|next|later)/i.test(context)) {
            output.add(`TASK-${code}`);
        }
    }
    return [...output].sort((left, right) => left.localeCompare(right));
}
export function dedupeTasks(tasks) {
    const seen = new Set();
    const output = [];
    for (const task of tasks) {
        const key = task.workItemId;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(task);
    }
    return output;
}
export function isTaskIdMentioned(workItemId, intent) {
    if (!intent || intent.mentionedTaskIds.length === 0)
        return false;
    return intent.mentionedTaskIds.includes(workItemId.trim().toUpperCase())
        || isTaskIdSuffixMentioned(workItemId, intent);
}
export function isTaskIdSuffixMentioned(workItemId, intent) {
    if (!intent || intent.mentionedTaskIds.length === 0)
        return false;
    const normalizedWorkItemId = workItemId.trim().toUpperCase();
    return intent.mentionedTaskIds.some((taskId) => {
        const normalizedTaskId = taskId.trim().toUpperCase();
        return normalizedTaskId.length > 0
            && normalizedTaskId !== normalizedWorkItemId
            && normalizedWorkItemId.endsWith(`-${normalizedTaskId}`);
    });
}
// Harmless comment for TASK-AAO-0120 deliverable check 3
