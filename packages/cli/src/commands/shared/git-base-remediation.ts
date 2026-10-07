import { spawnSync } from 'node:child_process';
import { CliError } from '../shared.ts';

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

/**
 * Governed commits need a Git repository. Outside one, the first Git read
 * fails with an opaque exit 128 deep in the commit path, so say up front that
 * the directory is not a repository yet and how to make it one.
 */
export function requireGitRepository(cwd: string, command: string): void {
  const base = describeMissingGitBase(cwd);
  if (base.hasHead || base.details.gitRepository !== false) return;
  throw new CliError('ATM_GIT_REPOSITORY_MISSING', `${command} needs a Git repository, and this directory is not one yet. Run the requiredCommand, then rerun ${command}.`, { exitCode: 1, details: base.details });
}
