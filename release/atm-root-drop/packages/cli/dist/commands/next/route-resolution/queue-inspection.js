// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { allowsPlanningMirror, statusQueueWeight } from '../match-and-sort.js';
import { readConfiguredPlanningRoots } from '../../planning-repo-root.js';
import { resolveCandidatePlanningRoots } from '../planning-root-preference.js';
import { bootstrapTaskId } from '../../governance-runtime.js';
import { parseJsonText } from '../../shared.js';
import { isPathAllowedByScope } from '../../work-channels.js';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, readStringArray, splitListValue } from '../intent-normalizers.js';
import { areTaskDependenciesSatisfied, canTaskBePreparedForClaim, isExplicitSingleTaskRoute, isTaskAlreadyActivelyClaimed, isTaskExplicitlyMentioned, isTaskRoutable, shouldDiscoverMarkdownTaskCards } from '../route-predicates.js';
import { uniqueSorted } from '../view-projections.js';
import { shouldReportPlanningRootMissing } from '../../planning-repo-root.js';
import { createNextProfiler, normalizeOptionalString } from './intent.js';
import { findActiveTaskQueueForIntent } from './runtime.js';
import { dedupeTasks, isActiveClaimedTask, isHandoffPrompt, isTaskIdMentioned, resolvePromptScopedTaskRoute } from './matching.js';
import { finalizeImportedTaskSummary, extractDeclaredTaskPathsFromDocument, extractLinkedSourceTaskArtifactPaths, extractTaskArtifactPathsFromMarkdown } from './artifact-scope.js';
import { findNearbyPlanPaths, listPromptScopedExternalTaskCardFiles, listTaskCardFiles } from './task-card-discovery.js';
export function inspectImportedTaskQueue(cwd, taskIntent, claimIntent = 'write') {
    const profile = createNextProfiler('ATM_NEXT_QUEUE_PROFILE');
    const planningRootResolution = resolveCandidatePlanningRoots(cwd, {
        configuredRoots: readConfiguredPlanningRoots(cwd)
    });
    profile.mark('resolve-planning-roots');
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    const jsonTasks = existsSync(taskStorePath) ? readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const rawText = readFileSync(filePath, 'utf8');
            const metadata = extractJsonTaskMetadata(rawText);
            if (metadata.schemaVersion !== 'atm.workItem.v0.2' && !metadata.hasSource) {
                return [];
            }
            const workItemId = metadata.workItemId;
            if (!workItemId)
                return [];
            const status = metadata.status ?? 'planned';
            const shouldHydrateScope = isTaskRoutable(status, taskIntent)
                || isTaskIdMentioned(workItemId, taskIntent)
                || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && normalizeTaskRouteStatus(status) === 'running');
            if (!shouldHydrateScope) {
                return [buildMinimalImportedJsonTaskSummary({
                        cwd,
                        filePath,
                        workItemId,
                        title: metadata.title ?? workItemId,
                        status,
                        sourcePlanPath: metadata.sourcePlanPath
                    })];
            }
            const parsed = parseJsonText(rawText);
            const dependencies = Array.isArray(parsed.dependencies)
                ? parsed.dependencies.filter((entry) => typeof entry === 'string')
                : [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            const source = parsed.source && typeof parsed.source === 'object' ? parsed.source : {};
            const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
            const outOfScope = readStringArray(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
            return [finalizeImportedTaskSummary({
                    workItemId,
                    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
                    status,
                    closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
                    closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
                    closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
                    lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
                    lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
                    milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
                    dependencies,
                    taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
                    format: 'json',
                    sourcePlanPath,
                    nearbyPlanPaths: [],
                    scopePaths: shouldHydrateScope ? (() => {
                        const explicit = uniqueSorted([
                            ...readStringArray(parsed.scope),
                            ...readStringArray(parsed.scopePaths),
                            ...readStringArray(parsed.files)
                        ].map((p) => {
                            const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                            return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                        }));
                        const claimFiles = readStringArray(claimRecord.files);
                        // ATM-BUG-2026-07-07-043/044: `tasks scope add` merges amended paths into
                        // taskDirectionLock.allowedFiles (and claim.files), but never rewrites this
                        // task's own static scope/scopePaths/files declaration. Re-hydrating scope
                        // here from `explicit` alone (and filtering claim.files against it) silently
                        // dropped scope-amendment paths on the next `next --claim`. Treat the
                        // governed taskDirectionLock.allowedFiles as an equally trusted source so
                        // scope amendments survive re-claim.
                        const directionLock = parsed.taskDirectionLock;
                        const lockAllowedFiles = directionLock && typeof directionLock === 'object' && !Array.isArray(directionLock)
                            ? readStringArray(directionLock.allowedFiles)
                            : [];
                        const rawScope = explicit.length > 0
                            ? uniqueSorted([
                                ...explicit,
                                ...claimFiles.filter((file) => isPathAllowedByScope(file, explicit)),
                                ...lockAllowedFiles
                            ])
                            : uniqueSorted([
                                ...extractDeclaredTaskPathsFromDocument(parsed),
                                ...extractLinkedSourceTaskArtifactPaths(cwd, sourcePlanPath)
                            ].map((p) => {
                                const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                                return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                            }));
                        return outOfScope.length > 0
                            ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
                            : rawScope;
                    })() : [],
                    outOfScope,
                    targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
                    planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
                    allowPlanningMirror: allowsPlanningMirror(parsed),
                    closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
                    activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
                        ? claimRecord.actorId
                        : null,
                    activeClaimLaneSessionId: claimRecord.state === 'active'
                        ? (() => {
                            const lane = claimRecord.laneSession;
                            if (!lane || typeof lane !== 'object' || Array.isArray(lane))
                                return null;
                            const laneSessionId = lane.laneSessionId;
                            return typeof laneSessionId === 'string' && laneSessionId.trim() ? laneSessionId.trim() : null;
                        })()
                        : null,
                    activeClaimIntent: claimRecord.state === 'active' && typeof claimRecord.intent === 'string'
                        ? claimRecord.intent
                        : (claimRecord.state === 'active' ? 'write' : null)
                }, cwd)];
        }
        catch {
            return [];
        }
    }) : [];
    profile.mark(`read-json-tasks count=${jsonTasks.length}`);
    const skipMarkdownTaskDiscovery = shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent);
    profile.mark(`should-skip-markdown-task-discovery value=${skipMarkdownTaskDiscovery}`);
    const skipExternalTaskCardScan = skipMarkdownTaskDiscovery || shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent);
    profile.mark(`should-skip-external-task-card-scan value=${skipExternalTaskCardScan}`);
    const markdownTaskFiles = shouldDiscoverMarkdownTaskCards(taskIntent) && !skipMarkdownTaskDiscovery
        ? uniqueSorted([
            ...listTaskCardFiles(cwd),
            ...(skipExternalTaskCardScan ? [] : listPromptScopedExternalTaskCardFiles(cwd, taskIntent, planningRootResolution.roots))
        ])
        : [];
    profile.mark('list-markdown-task-files');
    const markdownTasks = markdownTaskFiles
        .map((filePath) => {
        const rawText = readFileSync(filePath, 'utf8');
        const parsed = parseMarkdownFrontmatter(rawText);
        const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
            ?? path.basename(filePath).replace(/\.task\.md$/, '');
        if (!workItemId)
            return null;
        const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn ?? parsed.blocked_by ?? parsed.blockedBy);
        const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
        const outOfScope = splitListValue(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
        return finalizeImportedTaskSummary({
            workItemId,
            title: normalizeOptionalString(parsed.title ?? parsed.name) ?? workItemId,
            status: normalizeOptionalString(parsed.status) ?? 'planned',
            closedAt: normalizeOptionalString(parsed.closed_at ?? parsed.closedAt),
            closedByActor: normalizeOptionalString(parsed.closed_by_actor ?? parsed.closedByActor),
            closurePacket: normalizeOptionalString(parsed.closure_packet ?? parsed.closurePacket),
            lastTransitionId: normalizeOptionalString(parsed.last_transition_id ?? parsed.lastTransitionId),
            lastTransitionAt: normalizeOptionalString(parsed.last_transition_at ?? parsed.lastTransitionAt),
            milestone: normalizeOptionalString(parsed.milestone),
            dependencies,
            taskPath: relativeTaskPath,
            format: 'markdown',
            sourcePlanPath: normalizeOptionalString(parsed.plan_path ?? parsed.planPath ?? parsed.source_plan ?? parsed.sourcePlan ?? parsed.related_plan ?? parsed.relatedPlan),
            nearbyPlanPaths: findNearbyPlanPaths(cwd, filePath),
            scopePaths: (() => {
                const explicit = uniqueSorted([
                    ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
                    ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
                    ...splitListValue(parsed.allowed_files ?? parsed.allowedFiles),
                    ...splitListValue(parsed.deliverables),
                    ...splitListValue(parsed.paths)
                ].map((p) => {
                    const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                    return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                }));
                const rawScope = explicit.length > 0
                    ? explicit
                    : uniqueSorted([
                        ...extractTaskArtifactPathsFromMarkdown(cwd, rawText)
                    ].map((p) => {
                        const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                        return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                    }));
                return outOfScope.length > 0
                    ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
                    : rawScope;
            })(),
            outOfScope,
            targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
            planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
            allowPlanningMirror: allowsPlanningMirror(parsed),
            closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
            activeClaimActorId: null,
            activeClaimLaneSessionId: null,
            activeClaimIntent: null
        }, cwd);
    })
        .filter((entry) => entry !== null);
    profile.mark('read-markdown-tasks');
    const allTasks = dedupeTasks([...jsonTasks, ...markdownTasks]);
    profile.mark('dedupe-tasks');
    const tasks = allTasks
        .filter((task) => (!isTerminalImportedTask(task) || isTaskExplicitlyMentioned(task, taskIntent))
        && (isTaskRoutable(task.status, taskIntent)
            || isTaskExplicitlyMentioned(task, taskIntent)
            || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && isActiveClaimedTask(task))))
        .sort((left, right) => {
        const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
        return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
    const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
    const activeQueue = findActiveTaskQueueForIntent(cwd, taskIntent);
    profile.mark('find-active-task-queue');
    const activeQueueTasks = activeQueue
        ? pruneTerminalQueueTasks(activeQueue.taskIds
            .slice(activeQueue.currentIndex)
            .map((taskId) => allTasks.find((task) => task.workItemId === taskId))
            .filter((task) => Boolean(task)), taskIntent)
        : [];
    const promptScope = activeQueue && activeQueueTasks.length > 0
        ? {
            status: 'queue',
            selectedTasks: activeQueueTasks,
            targetRepo: activeQueue.targetRepo,
            diagnostics: [`active-queue:${activeQueue.queueId}`, `queue-index:${activeQueue.currentIndex}`]
        }
        : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution);
    profile.mark('resolve-prompt-scoped-task-route');
    const planningRootMissing = promptScope?.status === 'not-found' && taskIntent
        ? shouldReportPlanningRootMissing({
            cwd,
            taskScopeMentioned: taskIntent.taskScopeMentioned,
            mentionedPlanPaths: taskIntent.mentionedPlanPaths,
            userPrompt: taskIntent.userPrompt,
            matchedTaskCount: tasks.filter((task) => (task.matchScore ?? 0) > 0).length
        })
        : null;
    const selectedTaskPool = promptScope?.selectedTasks ?? [];
    const explicitSingleTaskRoute = isExplicitSingleTaskRoute(promptScope, taskIntent);
    const selectedTask = selectImportedTaskForPromptScope(selectedTaskPool, promptScope?.status === 'queue', explicitSingleTaskRoute, statusById, cwd);
    profile.mark('select-imported-task-for-prompt-scope');
    const claimableTask = selectedTask
        && selectedTask.format === 'json'
        && (isSelectedTaskClaimableForIntent(selectedTask, claimIntent) || isTaskAlreadyActivelyClaimed(selectedTask))
        && (areTaskDependenciesSatisfied(selectedTask, statusById, cwd) || isTaskAlreadyActivelyClaimed(selectedTask))
        ? selectedTask
        : null;
    profile.mark('resolve-claimable-task');
    profile.flush('inspect-imported-task-queue');
    return {
        taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
        openTaskCount: tasks.length,
        selectedTask,
        claimableTask,
        tasks,
        promptScope,
        planningRootWarnings: planningRootResolution.warnings,
        planningRootMissing
    };
}
export function extractJsonTaskMetadata(rawText) {
    const pick = (key) => {
        const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'm').exec(rawText);
        if (!match?.[1])
            return null;
        try {
            return JSON.parse(`"${match[1]}"`);
        }
        catch {
            return match[1];
        }
    };
    const sourcePlanPath = /"source"\s*:\s*\{[\s\S]*?"planPath"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/m.exec(rawText)?.[1] ?? null;
    return {
        schemaVersion: pick('schemaVersion'),
        workItemId: pick('workItemId') ?? pick('id') ?? '',
        title: pick('title'),
        status: pick('status'),
        sourcePlanPath: sourcePlanPath ? JSON.parse(`"${sourcePlanPath}"`) : (pick('planPath') ?? pick('plan_path')),
        hasSource: /"source"\s*:/.test(rawText)
    };
}
export function buildMinimalImportedJsonTaskSummary(input) {
    return {
        workItemId: input.workItemId,
        title: input.title,
        status: input.status,
        closedAt: null,
        closedByActor: null,
        closurePacket: null,
        lastTransitionId: null,
        lastTransitionAt: null,
        milestone: null,
        dependencies: [],
        taskPath: path.relative(input.cwd, input.filePath).replace(/\\/g, '/'),
        format: 'json',
        sourcePlanPath: input.sourcePlanPath,
        nearbyPlanPaths: [],
        scopePaths: [],
        outOfScope: [],
        targetRepo: null,
        planningRepo: null,
        allowPlanningMirror: false,
        closureAuthority: null,
        activeClaimActorId: null,
        activeClaimLaneSessionId: null,
        activeClaimIntent: null,
        planningReadOnlyPaths: [],
        planningMirrorPaths: [],
        targetAllowedFiles: []
    };
}
export function shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent) {
    if (!taskIntent?.taskScopeMentioned)
        return false;
    if (taskIntent.mentionedPlanPaths.length > 0)
        return false;
    const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
    if (promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0) {
        return true;
    }
    if (taskIntent.mentionedTaskIds.length === 0 && taskIntent.taskRootHints.length === 0)
        return false;
    return jsonTasks.some((task) => isTaskExplicitlyMentioned(task, taskIntent));
}
export function shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent) {
    if (!taskIntent?.taskScopeMentioned)
        return false;
    if (taskIntent.mentionedPlanPaths.length > 0)
        return false;
    if (taskIntent.mentionedTaskIds.length > 0
        && jsonTasks.some((task) => isTaskIdMentioned(task.workItemId, taskIntent))) {
        return true;
    }
    const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
    return Boolean(promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0);
}
function isTerminalImportedTask(task) {
    const status = normalizeTaskRouteStatus(task.status);
    return status === 'done'
        || status === 'abandoned'
        || Boolean(task.closedAt)
        || Boolean(task.closedByActor);
}
/**
 * ATM-GOV-0263: drop completed/abandoned/terminal tasks from an active queue
 * slice before queue-head selection so a full-plan prompt advances to the next
 * unblocked DAG task instead of returning an already-done prerequisite. An
 * explicitly named terminal task is kept so status/redo/reopen still resolve.
 */
export function pruneTerminalQueueTasks(tasks, taskIntent = null) {
    return tasks.filter((task) => !isTerminalImportedTask(task) || isTaskExplicitlyMentioned(task, taskIntent));
}
export function selectImportedTaskForPromptScope(selectedTaskPool, isActiveQueue, explicitSingleTaskRoute, statusById, cwd) {
    if (isActiveQueue || explicitSingleTaskRoute) {
        return selectedTaskPool[0] ?? null;
    }
    return selectedTaskPool.find((task) => areTaskDependenciesSatisfied(task, statusById, cwd)) ?? null;
}
export function isSelectedTaskClaimableForIntent(task, claimIntent) {
    const status = normalizeTaskRouteStatus(task.status);
    if (canTaskBePreparedForClaim(status))
        return true;
    if (status === 'in_progress' && !task.activeClaimActorId)
        return true;
    return status === 'review' && claimIntent === 'closeout-only';
}
export function hasPromptScopedWorkItems(importedTaskQueue) {
    return importedTaskQueue.tasks.some((task) => task.workItemId !== bootstrapTaskId);
}
