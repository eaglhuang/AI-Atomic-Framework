import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeStoredPlanningPathForIdentity } from './planning-repo-root.js';
const quickfixLockPath = ['.atm', 'runtime', 'quickfix-lock.json'];
const batchRunPath = ['.atm', 'runtime', 'batch-run.json'];
const batchRunsPath = ['.atm', 'runtime', 'batch-runs'];
export function readActiveQuickfixLock(cwd) {
    const filePath = path.join(cwd, ...quickfixLockPath);
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.quickfixLock.v1' || parsed.status !== 'active')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function writeQuickfixLock(input) {
    const filePath = path.join(input.cwd, ...quickfixLockPath);
    const record = {
        schemaId: 'atm.quickfixLock.v1',
        specVersion: '0.1.0',
        actorId: input.actorId,
        prompt: input.prompt,
        promptHash: sha256(input.prompt),
        reason: input.reason ?? null,
        allowedFiles: uniqueStrings(input.allowedFiles.map(normalizeRelativePath).filter(Boolean)),
        maxFiles: input.maxFiles ?? 3,
        maxChangedLines: input.maxChangedLines ?? 80,
        createdAt: new Date().toISOString(),
        status: 'active'
    };
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return record;
}
export function releaseQuickfixLock(cwd, actorId) {
    const active = readActiveQuickfixLock(cwd);
    if (!active || active.actorId !== actorId)
        return null;
    const filePath = path.join(cwd, ...quickfixLockPath);
    const released = {
        ...active,
        status: 'released'
    };
    writeFileSync(filePath, `${JSON.stringify(released, null, 2)}\n`, 'utf8');
    return released;
}
export function readActiveBatchRun(cwd, selector = {}) {
    return selectActiveBatchRun(cwd, selector);
}
export function listActiveBatchRuns(cwd) {
    return dedupeBatchRuns([
        ...listBatchRuns(cwd),
        ...readLegacyBatchRun(cwd)
    ]).filter((entry) => entry.status === 'active');
}
export function readBatchRunById(cwd, batchId) {
    const normalized = normalizeBatchId(batchId);
    if (!normalized)
        return null;
    const filePath = path.join(cwd, ...batchRunsPath, `${normalized}.json`);
    const direct = readBatchRunFile(filePath);
    if (direct)
        return direct;
    return listBatchRuns(cwd).find((entry) => entry.batchId === normalized) ?? readLegacyBatchRun(cwd).find((entry) => entry.batchId === normalized) ?? null;
}
export function findActiveBatchRunForTask(cwd, taskId) {
    return selectActiveBatchRun(cwd, { taskId });
}
export function selectActiveBatchRun(cwd, selector = {}) {
    const active = listActiveBatchRuns(cwd);
    const batchId = normalizeBatchId(selector.batchId ?? '');
    if (batchId)
        return active.find((entry) => entry.batchId === batchId) ?? null;
    const sourcePromptHash = selector.sourcePrompt?.trim() ? sha256(selector.sourcePrompt.trim()) : null;
    const scopeKey = normalizeOptionalSelector(selector.scopeKey);
    const taskId = normalizeOptionalSelector(selector.taskId);
    const actorId = normalizeOptionalSelector(selector.actorId);
    const filtered = active.filter((entry) => {
        if (scopeKey && entry.scopeKey !== scopeKey)
            return false;
        if (taskId && !entry.taskIds.includes(taskId))
            return false;
        if (actorId && entry.createdByActor !== actorId)
            return false;
        if (sourcePromptHash && entry.sourcePromptHash !== sourcePromptHash)
            return false;
        return true;
    });
    if (filtered.length === 1)
        return filtered[0] ?? null;
    return null;
}
export function activeBatchSelectionStatus(cwd, selector = {}) {
    const active = listActiveBatchRuns(cwd);
    const batchId = normalizeBatchId(selector.batchId ?? '');
    if (batchId) {
        const batchRun = active.find((entry) => entry.batchId === batchId) ?? null;
        return {
            ok: Boolean(batchRun),
            reason: batchRun ? null : 'batch-not-found',
            batchRun,
            candidates: batchRun ? [batchRun] : []
        };
    }
    const sourcePromptHash = selector.sourcePrompt?.trim() ? sha256(selector.sourcePrompt.trim()) : null;
    const scopeKey = normalizeOptionalSelector(selector.scopeKey);
    const taskId = normalizeOptionalSelector(selector.taskId);
    const actorId = normalizeOptionalSelector(selector.actorId);
    const candidates = active.filter((entry) => {
        if (scopeKey && entry.scopeKey !== scopeKey)
            return false;
        if (taskId && !entry.taskIds.includes(taskId))
            return false;
        if (actorId && entry.createdByActor !== actorId)
            return false;
        if (sourcePromptHash && entry.sourcePromptHash !== sourcePromptHash)
            return false;
        return true;
    });
    return {
        ok: candidates.length === 1,
        reason: candidates.length === 0 ? 'batch-not-found' : candidates.length > 1 ? 'batch-selection-required' : null,
        batchRun: candidates.length === 1 ? candidates[0] ?? null : null,
        candidates
    };
}
function readLegacyBatchRun(cwd) {
    const filePath = path.join(cwd, ...batchRunPath);
    if (!existsSync(filePath))
        return [];
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.batchRun.v1')
            return [];
        return [normalizeBatchRunRecord(parsed)];
    }
    catch {
        return [];
    }
}
export function writeBatchRun(input) {
    const prompt = input.sourcePrompt.trim();
    const queueTasks = input.queue?.tasks ?? null;
    const sourceTasks = queueTasks && queueTasks.length > 0 ? queueTasks : input.tasks;
    const taskIds = input.queue?.taskIds && input.queue.taskIds.length > 0
        ? [...input.queue.taskIds]
        : sourceTasks.map((task) => task.workItemId);
    const currentIndex = input.queue?.currentIndex ?? 0;
    const batchId = `batch-${sha256(`${prompt}|${taskIds.join(',')}`).slice(0, 12)}`;
    const record = {
        schemaId: 'atm.batchRun.v1',
        specVersion: '0.1.0',
        batchId,
        scopeKey: deriveBatchScopeKey(sourceTasks, prompt, taskIds, input.cwd),
        queueId: input.queue?.queueId ?? null,
        sourcePrompt: prompt,
        sourcePromptHash: sha256(prompt),
        targetRepo: input.queue?.targetRepo ?? resolveBatchTargetRepo(sourceTasks),
        taskIds,
        currentIndex,
        currentTaskId: taskIds[currentIndex] ?? null,
        commitMode: input.commitMode ?? 'per-task',
        checkpointSize: Math.max(1, input.checkpointSize ?? 3),
        pendingCommitTaskId: null,
        status: 'active',
        createdByActor: input.actorId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    writeBatchRunRecord(input.cwd, record);
    return record;
}
export function updateBatchRun(cwd, current, updates) {
    const record = {
        ...current,
        ...updates,
        updatedAt: new Date().toISOString()
    };
    writeBatchRunRecord(cwd, record);
    return record;
}
export function releaseBatchRun(cwd, current, status) {
    return updateBatchRun(cwd, current, {
        status,
        currentTaskId: status === 'completed' ? null : current.currentTaskId,
        hold: null
    });
}
export function inspectBatchRunConsistency(batchRun, taskQueue) {
    if (!batchRun || batchRun.status !== 'active') {
        return {
            ok: true,
            reason: null,
            queueHeadTaskId: null,
            batchHeadTaskId: null
        };
    }
    if (!taskQueue || taskQueue.status !== 'active') {
        return {
            ok: false,
            reason: 'active-batch-without-active-queue',
            queueHeadTaskId: null,
            batchHeadTaskId: batchRun.currentTaskId
        };
    }
    const queueHeadTaskId = taskQueue.taskIds[taskQueue.currentIndex] ?? null;
    const sameTaskIds = JSON.stringify([...batchRun.taskIds]) === JSON.stringify([...taskQueue.taskIds]);
    const sameIndex = batchRun.currentIndex === taskQueue.currentIndex;
    const sameHead = batchRun.currentTaskId === queueHeadTaskId;
    if (sameTaskIds && sameIndex && sameHead) {
        return {
            ok: true,
            reason: null,
            queueHeadTaskId,
            batchHeadTaskId: batchRun.currentTaskId
        };
    }
    return {
        ok: false,
        reason: 'batch-run-task-queue-mismatch',
        queueHeadTaskId,
        batchHeadTaskId: batchRun.currentTaskId
    };
}
export function repairBatchRunFromQueue(cwd, batchRun, taskQueue) {
    const queueHeadTaskId = taskQueue.taskIds[taskQueue.currentIndex] ?? null;
    return updateBatchRun(cwd, batchRun, {
        queueId: taskQueue.queueId,
        scopeKey: taskQueue.scopeKey ?? batchRun.scopeKey,
        targetRepo: taskQueue.targetRepo,
        taskIds: [...taskQueue.taskIds],
        currentIndex: taskQueue.currentIndex,
        currentTaskId: queueHeadTaskId,
        status: taskQueue.status === 'completed' || !queueHeadTaskId ? 'completed' : 'active'
    });
}
export function findBatchFileConflicts(input) {
    const files = input.files.map(normalizeRelativePath).filter(Boolean).filter((entry) => !entry.toLowerCase().startsWith('.atm/history/'));
    return input.otherBatches.flatMap((batchRun) => {
        if (input.currentBatchId && batchRun.batchId === input.currentBatchId)
            return [];
        const allowedFiles = input.allowedFilesByBatchId.get(batchRun.batchId) ?? [];
        const overlappingFiles = files.filter((file) => isPathAllowedByScope(file, allowedFiles));
        if (overlappingFiles.length === 0)
            return [];
        return [{
                batchId: batchRun.batchId,
                scopeKey: batchRun.scopeKey,
                taskIds: batchRun.taskIds,
                overlappingFiles: uniqueStrings(overlappingFiles)
            }];
    });
}
export function extractPathLikeStringsFromPrompt(prompt) {
    const candidates = new Set();
    const matches = prompt.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|pipelines|src|data|fixtures|README\.md|atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)(?:[\\/][A-Za-z0-9._-]+)*(?:\.[A-Za-z0-9._-]+)?\b/gi);
    for (const match of matches) {
        const normalized = normalizeRelativePath(match[0]);
        if (normalized)
            candidates.add(normalized);
    }
    return [...candidates].sort((left, right) => left.localeCompare(right));
}
export function isQuickfixPrompt(prompt) {
    const normalized = prompt.trim().toLowerCase();
    if (!normalized)
        return false;
    return /\b(typo|small fix|quick fix|quickfix|one line|one-line|rename|minor fix|hotfix)\b/.test(normalized)
        || /(小改|小修|小修正|快速修|快修|修一行|改一行|改個 typo|小 typo|小錯字|熱修)/.test(prompt);
}
export function isBatchPrompt(prompt) {
    const normalized = prompt.trim().toLowerCase();
    if (!normalized)
        return false;
    return /\b(all task cards|whole plan|entire plan|batch|all tasks|complete .* tasks)\b/.test(normalized)
        || /(全部任務卡|整份計畫|整個計畫|全部任務|批次完成|整批處理|一次做完|全部做完)/.test(prompt);
}
/**
 * Quickfix / batch scope path matcher. NOT the source of truth for task direction
 * lock allowed files. For task direction governance (claim → guard → close) use
 * `taskDirectionLock.allowedFiles` via `getCanonicalAllowedFilesForTask` /
 * `diagnoseTaskDirectionLockAllowedFiles` in `task-direction.ts` (TASK-AAO-0012).
 */
export function isPathAllowedByScope(filePath, allowedFiles) {
    const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
    if (!normalizedFile)
        return false;
    return allowedFiles.some((entry) => {
        const candidate = normalizeRelativePath(entry).toLowerCase();
        if (!candidate)
            return false;
        if (candidate.includes('*')) {
            const escaped = candidate
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
                .replace(/\*/g, '[^/]*')
                .replace(/__ATM_DOUBLE_STAR__/g, '.*');
            return new RegExp(`^${escaped}$`).test(normalizedFile);
        }
        return normalizedFile === candidate || normalizedFile.startsWith(`${candidate}/`);
    });
}
function resolveBatchTargetRepo(tasks) {
    return tasks.find((task) => task.targetRepo)?.targetRepo ?? null;
}
function writeBatchRunRecord(cwd, record) {
    const recordPath = path.join(cwd, ...batchRunsPath, `${record.batchId}.json`);
    mkdirSync(path.dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    // Keep the historical single-file location as a compatibility pointer for
    // older runners and adoption repos during the scoped-batch migration.
    const legacyPath = path.join(cwd, ...batchRunPath);
    mkdirSync(path.dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
function listBatchRuns(cwd) {
    const root = path.join(cwd, ...batchRunsPath);
    if (!existsSync(root))
        return [];
    try {
        return readDirJsonFiles(root).flatMap((filePath) => {
            const record = readBatchRunFile(filePath);
            return record ? [record] : [];
        });
    }
    catch {
        return [];
    }
}
function readBatchRunFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.batchRun.v1')
            return null;
        return normalizeBatchRunRecord(parsed);
    }
    catch {
        return null;
    }
}
function readDirJsonFiles(root) {
    return readdirSync(root)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => path.join(root, entry));
}
function normalizeBatchRunRecord(record) {
    const taskIds = Array.isArray(record.taskIds) ? record.taskIds.map(String).filter(Boolean) : [];
    return {
        ...record,
        scopeKey: record.scopeKey || deriveBatchScopeKey([], record.sourcePrompt ?? '', taskIds),
        queueId: record.queueId ?? null,
        taskIds,
        pendingCommitTaskId: typeof record.pendingCommitTaskId === 'string' && record.pendingCommitTaskId.trim().length > 0
            ? record.pendingCommitTaskId
            : null,
        skippedTasks: Array.isArray(record.skippedTasks) ? record.skippedTasks : []
    };
}
export function writeBatchTaskAuditEvent(input) {
    const createdAt = new Date().toISOString();
    const digest = sha256(JSON.stringify({
        taskId: input.taskId,
        action: input.action,
        actorId: input.actorId,
        batchId: input.batchId,
        reason: input.reason ?? null,
        batchIndex: input.batchIndex ?? null,
        createdAt
    })).slice(0, 12);
    const transitionId = `${createdAt.replace(/[:.]/g, '-')}-${input.action}-${digest}`;
    const event = {
        schemaId: 'atm.taskTransition.v1',
        specVersion: '0.1.0',
        transitionId,
        taskId: input.taskId,
        action: input.action,
        actorId: input.actorId,
        batchId: input.batchId,
        reason: input.reason ?? null,
        batchIndex: input.batchIndex ?? null,
        createdAt,
        command: `node atm.mjs batch ${input.action === 'batch-skip' ? 'skip' : 'resume'} --task ${input.taskId} --batch ${input.batchId} --actor ${input.actorId} --json`
    };
    const eventDir = path.join(input.cwd, '.atm', 'history', 'task-events', input.taskId);
    mkdirSync(eventDir, { recursive: true });
    const eventPath = path.join(eventDir, `${transitionId}.json`);
    writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    return {
        transitionId,
        eventPath: normalizeRelativePath(path.relative(input.cwd, eventPath))
    };
}
function dedupeBatchRuns(records) {
    const seen = new Set();
    const output = [];
    for (const record of records) {
        if (!record.batchId || seen.has(record.batchId))
            continue;
        seen.add(record.batchId);
        output.push(record);
    }
    return output.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
function deriveBatchScopeKey(tasks, prompt, taskIds, cwd) {
    const idRoots = uniqueStrings(taskIds.map((taskId) => {
        const match = taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/);
        return match?.[1] ?? '';
    }).filter(Boolean));
    if (idRoots.length === 1)
        return idRoots[0] ?? 'custom';
    const planPaths = uniqueStrings(tasks
        .map((task) => task.sourcePlanPath)
        .filter((entry) => Boolean(entry))
        .map((entry) => cwd ? normalizeStoredPlanningPathForIdentity(cwd, entry) : entry));
    if (planPaths.length === 1)
        return `plan-${sha256(planPaths[0] ?? '').slice(0, 12)}`;
    if (taskIds.length > 0)
        return `tasks-${sha256(taskIds.join('\n')).slice(0, 12)}`;
    return `prompt-${sha256(prompt).slice(0, 12)}`;
}
function normalizeBatchId(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : '';
}
function normalizeOptionalSelector(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizeRelativePath(value) {
    const normalized = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0 ? normalized : '';
}
function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
