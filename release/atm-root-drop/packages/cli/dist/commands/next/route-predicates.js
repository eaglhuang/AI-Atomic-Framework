import { normalizeSearchText, normalizeTaskRouteStatus } from './intent-normalizers.js';
function isFrameworkMaintenancePrompt(prompt) {
    const normalized = normalizeSearchText(prompt);
    return [
        'framework',
        'atm',
        'hook',
        'pre commit',
        'pre tool',
        'baseline',
        'guard',
        'validate',
        'framework mode',
        'integration',
        'runner',
        'governance',
        '治理',
        '框架',
        '基線',
        '防偏移',
        '暫態',
        '鉤子'
    ].some((signal) => normalized.includes(normalizeSearchText(signal)));
}
function isExplicitSingleTaskRoute(promptScope, taskIntent) {
    if (promptScope?.status !== 'ready' || promptScope.selectedTasks.length !== 1 || !taskIntent)
        return false;
    const selectedTaskId = promptScope.selectedTasks[0]?.workItemId.toUpperCase();
    if (!selectedTaskId)
        return false;
    return taskIntent.explicitTaskIds.includes(selectedTaskId)
        || taskIntent.mentionedTaskIds.includes(selectedTaskId);
}
import { areTaskDependenciesSatisfied } from '../tasks/dependency-gate.js';
function canTaskBePreparedForClaim(status) {
    const normalized = normalizeTaskRouteStatus(status);
    return normalized === 'planned'
        || normalized === 'open'
        || normalized === 'reserved'
        || normalized === 'ready';
}
function isTaskAlreadyActivelyClaimed(task) {
    return normalizeTaskRouteStatus(task.status) === 'running' && Boolean(task.activeClaimActorId);
}
function isClosedTaskStatus(status) {
    const normalized = normalizeTaskRouteStatus(status);
    return normalized === 'done' || normalized === 'verified';
}
function hasRequiredPromptScopeMatch(task, intent) {
    const reasons = task.matchReasons ?? [];
    if (intent.mentionedTaskIds.length > 0) {
        if (reasons.includes('task-id-exact'))
            return true;
        if (intent.queueRequested || intent.ordinalScope) {
            return reasons.includes('task-root-hint-match')
                || reasons.includes('nearby-plan-name-match')
                || reasons.includes('plan-path-match');
        }
        return false;
    }
    if (intent.mentionedPlanPaths.length > 0) {
        return reasons.includes('plan-path-match') || reasons.includes('nearby-plan-name-match');
    }
    if (intent.taskRootHints.length > 0) {
        return reasons.includes('task-root-hint-match') || reasons.includes('nearby-plan-name-match');
    }
    if (intent.targetRepoHints.length > 0) {
        return reasons.includes('target-repo-match');
    }
    return reasons.some((reason) => reason !== 'task-card-surface');
}
function isTaskCardSurfaceOnlyMatch(task) {
    const reasons = task.matchReasons ?? [];
    if (reasons.length === 0)
        return false;
    return (task.matchScore ?? 0) <= 20 && reasons.every((reason) => reason === 'task-card-surface');
}
function isTaskRoutable(status, intent) {
    const normalized = status.trim().toLowerCase();
    if (intent?.requestedAction === 'redo' || intent?.requestedAction === 'reopen' || intent?.requestedAction === 'audit') {
        return normalized !== 'abandoned' && normalized !== 'cancelled';
    }
    return ['ready', 'open', 'planned', 'blocked', 'waiting_target_evidence', 'reserved'].includes(normalized);
}
function isQueueRequestedPrompt(prompt) {
    return /\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u6240\u6709(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9|\u5f8c\u9762(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5f8c\u7e8c(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5269\u9918(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u63a5\u4e0b\u4f86(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u9010\u4e00(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u4e00\u5f35\u5f35(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u6574\u4efd\u8a08\u756b|\u6574\u500b\u8a08\u756b|all(?:[\s\S]{0,80})task\s+cards|all(?:[\s\S]{0,80})tasks|remaining(?:[\s\S]{0,80})(?:task\s+cards|tasks)|later(?:[\s\S]{0,80})(?:task\s+cards|tasks)|one\s+by\s+one(?:[\s\S]{0,80})(?:task\s+cards|tasks)|entire\s+plan|whole\s+plan|through\s+all/i.test(prompt);
}
function isTaskExplicitlyMentioned(task, intent) {
    if (!intent || intent.mentionedTaskIds.length === 0)
        return false;
    const normalizedStatus = normalizeTaskRouteStatus(task.status);
    if (normalizedStatus === 'abandoned' || normalizedStatus === 'cancelled') {
        return false;
    }
    return intent.mentionedTaskIds.includes(task.workItemId.toUpperCase());
}
function shouldDiscoverMarkdownTaskCards(intent) {
    if (!intent)
        return false;
    return intent.taskScopeMentioned
        || intent.queueRequested
        || intent.mentionedTaskIds.length > 0
        || intent.taskRootHints.length > 0
        || intent.mentionedPlanPaths.length > 0;
}
export { areTaskDependenciesSatisfied, canTaskBePreparedForClaim, hasRequiredPromptScopeMatch, isClosedTaskStatus, isExplicitSingleTaskRoute, isFrameworkMaintenancePrompt, isQueueRequestedPrompt, isTaskAlreadyActivelyClaimed, isTaskCardSurfaceOnlyMatch, isTaskExplicitlyMentioned, isTaskRoutable, shouldDiscoverMarkdownTaskCards };
