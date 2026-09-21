import path from 'node:path';
import { readJsonText } from '../commit-range-guard.js';
import { normalizeRelativePath, runGit } from '../git-index-diagnostics.js';
/**
 * Resolves evidence authority from the immutable HEAD tree.  This is a
 * deliberately narrow alternative to a staged ledger/event: it permits an
 * evidence-only closeback only for the task identity declared by the evidence
 * itself, and never consults mutable worktree or runtime projections.
 */
export function resolveCommittedTaskContext(cwd, taskId) {
    const normalizedTaskId = taskId.trim();
    const ledgerPath = normalizeRelativePath(path.join('.atm', 'history', 'tasks', `${normalizedTaskId}.json`));
    if (!isSafeTaskId(normalizedTaskId)) {
        return { ok: false, taskId: normalizedTaskId, source: null, ledgerPath, reason: 'invalid-task-id' };
    }
    const result = runGit(cwd, ['show', `HEAD:${ledgerPath}`]);
    if (result.exitCode !== 0) {
        return { ok: false, taskId: normalizedTaskId, source: null, ledgerPath, reason: 'committed-ledger-missing' };
    }
    let ledger;
    try {
        ledger = readJsonText(result.stdout);
    }
    catch {
        return { ok: false, taskId: normalizedTaskId, source: null, ledgerPath, reason: 'committed-ledger-invalid' };
    }
    const workItemId = typeof ledger?.workItemId === 'string'
        ? ledger.workItemId.trim()
        : '';
    if (workItemId !== normalizedTaskId) {
        return { ok: false, taskId: normalizedTaskId, source: null, ledgerPath, reason: 'committed-ledger-task-id-mismatch' };
    }
    return { ok: true, taskId: normalizedTaskId, source: 'committed-ledger', ledgerPath, reason: null };
}
function isSafeTaskId(taskId) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId);
}
