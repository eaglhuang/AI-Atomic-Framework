import path from 'node:path';
import { normalizeTaskRouteStatus, normalizeSearchText, normalizeOptionalTaskPath, normalizeOptionalBoolean } from './intent-normalizers.js';
export function compareScoredTasks(left, right) {
    const scoreDelta = (right.matchScore ?? 0) - (left.matchScore ?? 0);
    if (scoreDelta !== 0)
        return scoreDelta;
    const statusDelta = statusQueueWeight(left.status) - statusQueueWeight(right.status);
    return statusDelta !== 0 ? statusDelta : left.workItemId.localeCompare(right.workItemId);
}
export function compareGuidedLegacyQueuePriority(left, right) {
    const statusDelta = humanReviewStatusWeight(left.status) - humanReviewStatusWeight(right.status);
    if (statusDelta !== 0) {
        return statusDelta;
    }
    return compareIsoDesc(left.review?.decidedAt ?? left.queuedAt ?? left.proposal.proposedAt, right.review?.decidedAt ?? right.queuedAt ?? right.proposal.proposedAt);
}
export function compareIsoDesc(left, right) {
    const leftValue = left ?? '';
    const rightValue = right ?? '';
    if (leftValue === rightValue) {
        return 0;
    }
    return leftValue > rightValue ? -1 : 1;
}
export function looksLikeTaskArtifact(filePath, task) {
    const normalized = normalizeOptionalTaskPath(filePath)?.toLowerCase() ?? '';
    if (!normalized)
        return false;
    if (normalized.startsWith('.git/') || normalized.startsWith('node_modules/'))
        return false;
    const taskText = [
        task.workItemId,
        task.title,
        task.sourcePlanPath ?? '',
        ...task.scopePaths,
        ...task.targetAllowedFiles
    ].join(' ').toLowerCase();
    const fileTokens = tokenizeForMatch(normalized);
    const taskTokens = new Set(tokenizeForMatch(taskText));
    if (fileTokens.some((token) => taskTokens.has(token)))
        return true;
    if (normalized.startsWith('atomic_workbench/') && /\batomization\b|generated|fixture|exclusion|dogfood|coverage/.test(taskText))
        return true;
    if (normalized.startsWith('docs/ai_atomic_framework/') && task.sourcePlanPath?.includes('docs/ai_atomic_framework/'))
        return true;
    return false;
}
export function isLikelyPromptPathHint(value) {
    const normalized = value.replace(/\\/g, '/').trim();
    if (!normalized)
        return false;
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('.atm/') || normalized.startsWith('.github/'))
        return true;
    if (/\.md$/i.test(normalized))
        return true;
    return /^(?:app|apps|assets|atomic_workbench|client|config|docs|examples|fixtures|integrations|lib|packages|public|release|schemas|scripts|server|specs|src|templates|tests|tools|ui|web)\//.test(normalized);
}
export function pathFieldMatches(field, hint) {
    const normalizedField = normalizeSearchText(field);
    const normalizedHint = normalizeSearchText(hint);
    const fieldStem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
    const hintStem = normalizeSearchText(path.basename(hint).replace(/\.[^.]+$/, ''));
    return normalizedField.includes(normalizedHint)
        || normalizedHint.includes(normalizedField)
        || Boolean(fieldStem && hintStem && (fieldStem.includes(hintStem) || hintStem.includes(fieldStem)));
}
export function looksLikeNamedPlanPrompt(prompt) {
    const normalized = normalizeSearchText(prompt);
    if (!/(?:\u8a08\u756b\u66f8|\u8a08\u756b|\u6587\u4ef6|plan|roadmap|spec|document)/i.test(prompt))
        return false;
    return normalized.length >= 10;
}
export function allowsPlanningMirror(record) {
    for (const key of [
        'allow_planning_mirror',
        'allowPlanningMirror',
        'planning_mirror_required',
        'planningMirrorRequired',
        'mirror_required',
        'mirrorRequired',
        'import_required',
        'importRequired'
    ]) {
        const value = normalizeOptionalBoolean(record[key]);
        if (value !== null)
            return value;
    }
    return false;
}
export function statusQueueWeight(status) {
    const normalized = normalizeTaskRouteStatus(status);
    if (normalized === 'ready')
        return 0;
    if (normalized === 'open')
        return 1;
    if (normalized === 'planned')
        return 2;
    if (normalized === 'blocked' || normalized === 'waiting_target_evidence')
        return 3;
    return 3;
}
export function humanReviewStatusWeight(status) {
    if (status === 'approved')
        return 0;
    if (status === 'pending')
        return 1;
    if (status === 'blocked')
        return 2;
    return 3;
}
export function decisionResultForStatus(status) {
    if (status === 'prompt-guidance-required')
        return 'info';
    if (/blocked|required|not-found|selection|repair/i.test(status))
        return 'blocked';
    if (/ready|action|closed|claimed|queue/i.test(status))
        return 'pass';
    return 'info';
}
export function tokenizeForMatch(value) {
    return value
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 3);
}
export function countTokenOverlap(prompt, title) {
    const promptTokens = new Set(tokenizeForMatch(prompt));
    return tokenizeForMatch(title).filter((token) => promptTokens.has(token)).length;
}
