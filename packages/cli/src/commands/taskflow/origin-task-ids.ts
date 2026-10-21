import { spawnSync } from 'node:child_process';

/** Refresh all origin heads: cached main alone cannot reserve a task number. */
export function collectOriginTaskSuffixes(cwd: string, format: string, directory: string): number[] {
  const git = (args: string[], allowFailure = false): string => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 && !allowFailure) {
      throw new Error('Cannot discover origin task IDs; run git fetch origin before allocating a task. ' + (result.stderr || result.error?.message || 'Git failed.'));
    }
    return result.status === 0 ? result.stdout.trim() : '';
  };
  if (!git(['rev-parse', '--git-dir'], true) || !git(['remote']).split('\n').includes('origin')) return [];
  git(['fetch', '--no-tags', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/']).split('\n').filter(Boolean);
  const roots = [...new Set(['.atm/task-plans', '.atm/history/tasks', ...(directory === '.' ? [] : [directory])])];
  const trees = new Set<string>();
  for (const ref of refs) {
    for (const root of roots) {
      const tree = git(['rev-parse', '--verify', `${ref}:${root}`], true);
      if (tree) trees.add(tree);
    }
  }
  const prefix = format.replace(/N+$/, '');
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}(\\d+)(?![A-Za-z0-9])`, 'g');
  const suffixes = new Set<number>();
  for (const tree of trees) {
    // Scan contents as well as names: plan documents may contain several cards.
    const names = git(['ls-tree', '-r', '--name-only', tree]);
    const result = spawnSync('git', ['grep', '-h', '-I', '-o', '-E', `${escaped}[0-9]+`, tree], {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0 && result.status !== 1) throw new Error('Cannot read origin task cards; refresh origin before allocating.');
    for (const match of `${names}\n${result.stdout}`.matchAll(pattern)) suffixes.add(Number(match[1]));
  }
  return [...suffixes];
}
