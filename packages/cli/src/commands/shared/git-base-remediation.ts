import { spawnSync } from 'node:child_process';

/**
 * Task cards record the repository identity and base commit they were
 * opened from; a card opened before the first commit cannot be claimed later
 * (planning-source identity drift). Describe how to create that first commit.
 */
export function describeMissingGitBase(cwd: string): { readonly hasHead: boolean; readonly details: Record<string, unknown> } {
  if (spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' }).status === 0) {
    return { hasHead: true, details: {} };
  }
  const isRepository = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }).status === 0;
  const requiredCommand = isRepository
    ? 'git add -A && git commit -m "Initial commit"'
    : 'git init && git add -A && git commit -m "Initial commit"';
  return {
    hasHead: false,
    details: {
      gitRepository: isRepository,
      requiredCommand,
      reason: isRepository ? 'The repository has no commit yet.' : 'This directory is not a git repository yet.'
    }
  };
}
