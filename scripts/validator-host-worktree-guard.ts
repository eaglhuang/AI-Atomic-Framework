import { spawnSync } from 'node:child_process';

export interface HostWorktreeSnapshot {
  readonly label: string;
  readonly stagedPaths: readonly string[];
  readonly contentByPath: Readonly<Record<string, string>>;
}

export function captureHostWorktreeSnapshot(cwd: string, label: string): HostWorktreeSnapshot {
  const stagedPaths = listStagedPaths(cwd);
  const contentByPath: Record<string, string> = {};
  for (const relativePath of stagedPaths) {
    const blob = runGit(cwd, ['show', `:${relativePath}`]);
    if (blob.status !== 0) {
      throw new Error(`Failed to snapshot staged file ${relativePath} for ${label}.`);
    }
    contentByPath[relativePath] = blob.stdout;
  }
  return { label, stagedPaths, contentByPath };
}

export function assertHostWorktreeSnapshotUnchanged(
  before: HostWorktreeSnapshot,
  after: HostWorktreeSnapshot
): void {
  const changedPaths = before.stagedPaths.filter((relativePath) => {
    return before.contentByPath[relativePath] !== after.contentByPath[relativePath];
  });
  if (changedPaths.length === 0) return;
  throw new Error([
    `Validator host worktree guard detected staged content changes during ${before.label}.`,
    `Affected staged paths: ${changedPaths.join(', ')}`,
    'ATM validators must not run git restore/checkout against the host repository.',
    'If you need to clean scope, do it explicitly outside validator runs.'
  ].join(' '));
}

function listStagedPaths(cwd: string): string[] {
  const result = runGit(cwd, ['diff', '--cached', '--name-only']);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runGit(cwd: string, args: readonly string[]) {
  return spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8'
  });
}
