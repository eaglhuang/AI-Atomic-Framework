import { runGitCommand } from './git-process-port.ts';
import { normalizeRelativePath, pathMatchesTaskScope, uniqueSorted } from '../commit-scope-policy.ts';

function readIgnoredUntrackedFiles(cwd: string): readonly string[] {
  try {
    return runGitCommand(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard'])
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch { return []; }
}

export function listTaskDeclaredIgnoredWorktreeFiles(cwd: string, declaredScope: readonly string[]): readonly string[] {
  if (declaredScope.length === 0) return [];
  return uniqueSorted(readIgnoredUntrackedFiles(cwd).filter((filePath) => declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope))));
}
