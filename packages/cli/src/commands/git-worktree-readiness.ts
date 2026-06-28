import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type GitWorktreeReadinessStatus =
  | 'ready'
  | 'not-git'
  | 'bare-worktree-mismatch'
  | 'bare-repository'
  | 'git-error';

export interface GitWorktreeReadinessReport {
  readonly ok: boolean;
  readonly status: GitWorktreeReadinessStatus;
  readonly cwd: string;
  readonly worktreeRoot: string | null;
  readonly gitDir: string | null;
  readonly isBareRepository: boolean | null;
  readonly isInsideWorkTree: boolean | null;
  readonly reason: string | null;
  readonly localConfigLikely: boolean;
  readonly recommendedFixCommand: string | null;
}

export function inspectGitWorktreeReadiness(cwd: string): GitWorktreeReadinessReport {
  const resolvedCwd = path.resolve(cwd);
  const bare = runGit(resolvedCwd, ['rev-parse', '--is-bare-repository']);
  const inside = runGit(resolvedCwd, ['rev-parse', '--is-inside-work-tree']);
  const root = runGit(resolvedCwd, ['rev-parse', '--show-toplevel']);
  const gitDir = runGit(resolvedCwd, ['rev-parse', '--git-dir']);
  const markerRoot = findNearestGitMarkerRoot(resolvedCwd);
  const gitDirPath = resolveGitDirPath(resolvedCwd, gitDir.stdout.trim() || null);
  const isBareRepository = bare.ok ? bare.stdout.trim() === 'true' : null;
  const isInsideWorkTree = inside.ok ? inside.stdout.trim() === 'true' : null;

  if (isBareRepository === true && markerRoot) {
    return {
      ok: false,
      status: 'bare-worktree-mismatch',
      cwd: resolvedCwd,
      worktreeRoot: toPortablePath(markerRoot),
      gitDir: gitDirPath ? toPortablePath(gitDirPath) : null,
      isBareRepository,
      isInsideWorkTree,
      reason: firstReason(
        root.stderr,
        inside.stderr,
        bare.stderr,
        root.stdout,
        inside.stdout,
        bare.stdout,
        'Git reports this path as a bare repository even though a worktree-local .git marker exists.'
      ),
      localConfigLikely: true,
      recommendedFixCommand: 'git config --local core.bare false'
    };
  }

  if (isInsideWorkTree === true && root.ok) {
    return {
      ok: true,
      status: 'ready',
      cwd: resolvedCwd,
      worktreeRoot: toPortablePath(root.stdout.trim()),
      gitDir: gitDirPath ? toPortablePath(gitDirPath) : null,
      isBareRepository,
      isInsideWorkTree,
      reason: null,
      localConfigLikely: false,
      recommendedFixCommand: null
    };
  }

  if (isBareRepository === true) {
    return {
      ok: true,
      status: 'bare-repository',
      cwd: resolvedCwd,
      worktreeRoot: null,
      gitDir: gitDirPath ? toPortablePath(gitDirPath) : null,
      isBareRepository,
      isInsideWorkTree,
      reason: firstReason(bare.stderr, inside.stderr, root.stderr, 'Git repository is bare and has no checked-out worktree.'),
      localConfigLikely: false,
      recommendedFixCommand: null
    };
  }

  const combinedReason = firstReason(inside.stderr, root.stderr, bare.stderr, inside.stdout, root.stdout, bare.stdout, null);
  const notGit = /not a git repository/i.test(combinedReason ?? '');
  return {
    ok: notGit || !combinedReason,
    status: notGit
      ? 'not-git'
      : combinedReason
        ? 'git-error'
        : 'not-git',
    cwd: resolvedCwd,
    worktreeRoot: null,
    gitDir: gitDirPath ? toPortablePath(gitDirPath) : null,
    isBareRepository,
    isInsideWorkTree,
    reason: combinedReason,
    localConfigLikely: false,
    recommendedFixCommand: null
  };
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: createSanitizedGitEnv()
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n').trim()
  };
}

function createSanitizedGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) {
    delete env[key];
  }
  return env;
}

function findNearestGitMarkerRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveGitDirPath(cwd: string, gitDir: string | null): string | null {
  if (!gitDir) return null;
  return path.isAbsolute(gitDir)
    ? path.resolve(gitDir)
    : path.resolve(cwd, gitDir);
}

function firstReason(...values: Array<string | null>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}
