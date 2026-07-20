import * as path from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { readTaskLedgerPolicy, transitionEventExists } from '../task-ledger.js';
export function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
export function collectTaskFileValues(value, files) {
    if (typeof value === 'string') {
        const normalized = normalizeRelativePath(value);
        if (normalized)
            files.add(normalized);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectTaskFileValues(entry, files);
        }
    }
}
export function taskPathFor(cwd, taskId) {
    const taskLedger = readTaskLedgerPolicy(cwd);
    return path.join(cwd, taskLedger.taskRoot, `${taskId}.json`);
}
export function safeTaskFileReadDir(directoryPath) {
    try {
        return readdirSync(directoryPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
export function safeTaskFileStat(filePath) {
    try {
        return statSync(filePath);
    }
    catch {
        return null;
    }
}
export function readJsonRecord(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function normalizeStringValue(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
export function legacyTaskRequiresBaseline(cwd, task) {
    const originProvider = normalizeStringValue(task.document.originProvider ?? task.document.origin_provider);
    const originTaskId = normalizeStringValue(task.document.originTaskId ?? task.document.origin_task_id);
    const transitionRequired = task.status === 'done' || Boolean(originProvider || originTaskId);
    if (!transitionRequired)
        return false;
    const lastTransitionId = normalizeStringValue(task.document.lastTransitionId ?? task.document.last_transition_id);
    if (!lastTransitionId)
        return true;
    return !transitionEventExists(cwd, task.taskId, lastTransitionId);
}
