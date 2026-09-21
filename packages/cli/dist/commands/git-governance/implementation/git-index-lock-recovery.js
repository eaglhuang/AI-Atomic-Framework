import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../../shared.js';
import { runGitCommand } from './git-process-port.js';
export const GIT_INDEX_LOCK_RECOVERY_FLAG = '--force-index-lock-recovery';
export function inspectGitIndexLock(cwd, nowMs = Date.now()) {
    const reportedPath = runGitCommand(cwd, ['rev-parse', '--git-path', 'index.lock']).trim();
    const lockPath = path.resolve(cwd, reportedPath || path.join('.git', 'index.lock'));
    if (!existsSync(lockPath))
        return { lockPath, exists: false, ageMs: null, sizeBytes: null };
    const stat = statSync(lockPath);
    return {
        lockPath,
        exists: true,
        ageMs: Math.max(0, nowMs - stat.mtimeMs),
        sizeBytes: stat.size,
    };
}
/**
 * The emergency gate establishes human authority; this module deliberately
 * owns only the filesystem transition and its observable before/after state.
 */
export function recoverGitIndexLock(input) {
    const before = inspectGitIndexLock(input.cwd, input.nowMs);
    if (!before.exists)
        return { action: 'already-absent', before, after: before };
    if (!input.force) {
        throw new CliError('ATM_GIT_INDEX_LOCK_PRESENT', 'Git index.lock is present. Confirm no active Git writer, obtain an emergency approval, then retry with the explicit recovery flag.', { exitCode: 1, details: { before, requiredFlag: GIT_INDEX_LOCK_RECOVERY_FLAG } });
    }
    if (input.dryRun)
        return { action: 'would-remove', before, after: before };
    rmSync(before.lockPath, { force: false });
    const after = inspectGitIndexLock(input.cwd, input.nowMs);
    if (after.exists) {
        throw new CliError('ATM_GIT_INDEX_LOCK_PRESENT', 'Git index.lock remained after the governed recovery attempt.', {
            exitCode: 1,
            details: { before, after },
        });
    }
    return { action: 'removed', before, after };
}
