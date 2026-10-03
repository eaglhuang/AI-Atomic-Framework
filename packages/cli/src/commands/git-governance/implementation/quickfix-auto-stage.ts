import { spawnSync } from 'node:child_process';
import { readActiveQuickfixLock } from '../../work-channels.ts';

/**
 * Stages the dirty files a fast-route quickfix lock allows for its owner.
 * A taskless commit has no task scope to auto-stage from, so the actor's own
 * quickfix lock supplies it; pre-commit still enforces the lock's file and
 * line limits.
 */
export function autoStageQuickfixLockFiles(cwd: string, actorId: string): readonly string[] {
  const lock = readActiveQuickfixLock(cwd);
  if (!lock || lock.actorId !== actorId || lock.allowedFiles.length === 0) return [];
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...lock.allowedFiles], { cwd, encoding: 'utf8' });
  const dirty = String(status.stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
  if (dirty.length === 0) return [];
  spawnSync('git', ['add', '--', ...dirty], { cwd, encoding: 'utf8' });
  return dirty;
}
