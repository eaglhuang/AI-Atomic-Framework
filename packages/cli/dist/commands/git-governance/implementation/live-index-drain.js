/**
 * Drain reconciliation debt from its own durable receipt.
 *
 * `recoverLiveIndexAfterSuccessfulCommit` recovers one named commit, and proves
 * its pre-state from that commit's parent tree. That is the right proof while a
 * single commit is behind, and it correctly refuses once a later commit rewrote
 * the same path: the live index then holds the blob from before the FIRST
 * unreconciled commit, while the worktree matches HEAD, so no single commit's
 * parent-and-tree pair describes the state.
 *
 * Accumulated debt therefore needs its own proof, and it has one. A path is
 * drainable exactly when its live index entry still equals the parent tree of
 * the commit that first left it unreconciled — nothing has touched that entry
 * since — and its worktree bytes equal HEAD. Both facts are checked here per
 * path; anything else is retained untouched, including every foreign entry.
 *
 * The receipt supplies the lineage, so this needs no operator-supplied sha: the
 * durable record of the problem is sufficient input to the repair.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../../shared.js';
import { runGitCommand } from './git-process-port.js';
import { applyLiveIndexHeadEntry, readHeadCommit, readIndexEntries, readTreeEntries, readWorktreeEntries, sameEntry } from './live-index-reconciliation.js';
export const LIVE_INDEX_DRAIN_SCHEMA_ID = 'atm.liveIndexDrain.v1';
const QUIET_STDIO = ['ignore', 'pipe', 'pipe'];
function receiptRelativePath(taskId) {
    return `.atm/history/evidence/${taskId}.live-index-reconciliation.json`;
}
function readReceipt(cwd, taskId) {
    const absolutePath = path.join(cwd, receiptRelativePath(taskId));
    if (!existsSync(absolutePath)) {
        throw new CliError('ATM_LIVE_INDEX_DRAIN_RECEIPT_MISSING', 'Draining reconciliation debt requires the durable live-index reconciliation receipt for this task.', { exitCode: 1, details: { taskId, expectedPath: receiptRelativePath(taskId) } });
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_LIVE_INDEX_DRAIN_RECEIPT_UNREADABLE', 'The live-index reconciliation receipt could not be parsed, so the debt it records cannot be proven.', { exitCode: 1, details: { taskId, path: receiptRelativePath(taskId), cause: String(error) } });
    }
    const retained = parsed?.retainedPaths;
    return Array.isArray(retained) ? retained : [];
}
function resolveParentSha(cwd, commitSha) {
    try {
        return runGitCommand(cwd, ['rev-parse', '--verify', `${commitSha}^`], QUIET_STDIO).trim() || null;
    }
    catch {
        return null;
    }
}
/**
 * Advance every retained path whose pre-state is still provable, and leave the
 * rest exactly as they are.
 */
export function drainLiveIndexReconciliationReceipt(input) {
    const { cwd, taskId, dryRun, budgetBytes } = input;
    const headSha = readHeadCommit(cwd);
    const entries = readReceipt(cwd, taskId);
    const drainedPaths = [];
    const alreadyAlignedPaths = [];
    const retainedPaths = [];
    const paths = entries
        .map((entry) => (typeof entry?.path === 'string' ? entry.path : ''))
        .filter(Boolean);
    if (paths.length === 0 || headSha === null) {
        return report({ taskId, headSha, dryRun, drainedPaths, alreadyAlignedPaths, retainedPaths });
    }
    const current = readIndexEntries(cwd, paths, undefined, budgetBytes);
    const head = readTreeEntries(cwd, headSha, paths, budgetBytes);
    const worktree = readWorktreeEntries(cwd, paths, head, budgetBytes);
    for (const entry of entries) {
        const filePath = typeof entry?.path === 'string' ? entry.path : '';
        if (!filePath)
            continue;
        const lineage = typeof entry?.firstUnreconciledCommit === 'string' ? entry.firstUnreconciledCommit : '';
        if (!lineage) {
            // A receipt written before lineage was recorded cannot prove a pre-state.
            // It is reported, never guessed at.
            retainedPaths.push({ path: filePath, reason: 'missing-lineage' });
            continue;
        }
        // A drained path leaves the receipt describing history rather than debt.
        // Recognising it here is what makes a repeat run a no-op instead of reading
        // the completed repair as a concurrent index change.
        if (sameEntry(current[filePath], head[filePath])) {
            alreadyAlignedPaths.push(filePath);
            continue;
        }
        const parentSha = resolveParentSha(cwd, lineage);
        if (parentSha === null) {
            retainedPaths.push({ path: filePath, reason: 'unresolvable-lineage' });
            continue;
        }
        const preState = readTreeEntries(cwd, parentSha, [filePath], budgetBytes)[filePath] ?? null;
        if (!sameEntry(current[filePath], preState)) {
            retainedPaths.push({ path: filePath, reason: 'concurrent-index-change' });
            continue;
        }
        if (!sameEntry(worktree[filePath], head[filePath])) {
            retainedPaths.push({ path: filePath, reason: 'worktree-diverged' });
            continue;
        }
        if (!dryRun) {
            applyLiveIndexHeadEntry(cwd, filePath, head[filePath], input.lockRetry);
        }
        drainedPaths.push(filePath);
    }
    return report({ taskId, headSha, dryRun, drainedPaths, alreadyAlignedPaths, retainedPaths });
}
function report(input) {
    return {
        schemaId: LIVE_INDEX_DRAIN_SCHEMA_ID,
        taskId: input.taskId,
        headSha: input.headSha,
        dryRun: input.dryRun,
        mutated: !input.dryRun && input.drainedPaths.length > 0,
        drainedPaths: input.drainedPaths,
        alreadyAlignedPaths: input.alreadyAlignedPaths,
        retainedPaths: input.retainedPaths,
        clean: input.retainedPaths.length === 0
    };
}
