import { runGitCommand } from './git-process-port.ts';
import { normalizeRelativePath, pathMatchesTaskScope, uniqueSorted } from '../commit-scope-policy.ts';

function readIgnoredUntrackedFiles(cwd: string, declaredScope: readonly string[]): readonly string[] {
  try {
    const normalizedScope = uniqueSorted(
      declaredScope
        .map((entry) => normalizeRelativePath(entry))
        .filter(Boolean),
    );
    // A scoped pathspec avoids traversing the adopter's entire ignored
    // worktree (often node_modules/build output).  For glob declarations use
    // their literal parent directory as a conservative superset; ATM's own
    // matcher remains the final authority below.
    const searchRoots = uniqueSorted(normalizedScope.map((entry) => {
      const wildcard = [entry.indexOf('*'), entry.indexOf('?'), entry.indexOf('[')]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0];
      if (wildcard === undefined) return entry;
      const parentSlash = entry.lastIndexOf('/', wildcard);
      return parentSlash >= 0 ? entry.slice(0, parentSlash) || '.' : '.';
    }));
    const pathspecBytes = searchRoots.reduce(
      (total, entry) => total + Buffer.byteLength(entry, 'utf8') + 1,
      0,
    );
    const args = ['ls-files', '--others', '--ignored', '--exclude-standard'];
    if (searchRoots.length > 0 && pathspecBytes <= 8_000) {
      args.push('--', ...searchRoots);
    }
    return runGitCommand(cwd, args)
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch { return []; }
}

export function listTaskDeclaredIgnoredWorktreeFiles(cwd: string, declaredScope: readonly string[]): readonly string[] {
  if (declaredScope.length === 0) return [];
  return uniqueSorted(readIgnoredUntrackedFiles(cwd, declaredScope).filter((filePath) => declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope))));
}
