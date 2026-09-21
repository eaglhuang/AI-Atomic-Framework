import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../../shared.ts';
import { runGitCommand } from './git-process-port.ts';

export const GIT_INDEX_LOCK_RECOVERY_FLAG = '--force-index-lock-recovery';

export interface GitIndexLockInspection {
  readonly lockPath: string;
  readonly exists: boolean;
  readonly ageMs: number | null;
  readonly sizeBytes: number | null;
}

export function inspectGitIndexLock(cwd: string, nowMs = Date.now()): GitIndexLockInspection {
  const reportedPath = runGitCommand(cwd, ['rev-parse', '--git-path', 'index.lock']).trim();
  const lockPath = path.resolve(cwd, reportedPath || path.join('.git', 'index.lock'));
  if (!existsSync(lockPath)) return { lockPath, exists: false, ageMs: null, sizeBytes: null };
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
export function recoverGitIndexLock(input: {
  readonly cwd: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly nowMs?: number;
}) {
  const before = inspectGitIndexLock(input.cwd, input.nowMs);
  if (!before.exists) return { action: 'already-absent' as const, before, after: before };
  if (!input.force) {
    throw new CliError(
      'ATM_GIT_INDEX_LOCK_PRESENT',
      'Git index.lock is present. Confirm no active Git writer, obtain an emergency approval, then retry with the explicit recovery flag.',
      { exitCode: 1, details: { before, requiredFlag: GIT_INDEX_LOCK_RECOVERY_FLAG } },
    );
  }
  if (input.dryRun) return { action: 'would-remove' as const, before, after: before };
  rmSync(before.lockPath, { force: false });
  const after = inspectGitIndexLock(input.cwd, input.nowMs);
  if (after.exists) {
    throw new CliError('ATM_GIT_INDEX_LOCK_PRESENT', 'Git index.lock remained after the governed recovery attempt.', {
      exitCode: 1,
      details: { before, after },
    });
  }
  return { action: 'removed' as const, before, after };
}
