export type DeliveryCommand = (program: string, args: string[]) => string;

// Publication only: no staging, commits, branch creation, force push or release.
export function deliverPr(run: DeliveryCommand, input: { title: string; body: string; dryRun?: boolean }) {
  if (!input.title.trim() || !input.body.trim()) throw new Error('PR title and body are required');
  const repo = JSON.parse(run('gh', ['api', 'repos/{owner}/{repo}'])) as {
    full_name: string; default_branch: string; allow_auto_merge: boolean;
  };
  const branch = run('git', ['branch', '--show-current']).trim();
  if (!branch || branch === repo.default_branch || !branch.startsWith('codex/')) {
    throw new Error('Delivery requires a named codex/ contribution branch, not the protected default branch');
  }
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['status', '--porcelain']).split(/\r?\n/).filter(Boolean);
  if (dirty.some((line) => !line.startsWith('?? .atm/runtime/'))) {
    throw new Error('Commit or explicitly preserve non-runtime WIP before delivery; nothing was pushed');
  }
  if (!repo.allow_auto_merge) throw new Error('Repository auto-merge must be enabled without relaxing branch protection');
  const prs = JSON.parse(run('gh', [
    'pr', 'list', '--repo', repo.full_name, '--head', branch, '--base', repo.default_branch,
    '--state', 'open', '--json', 'number,url'
  ])) as Array<{ number: number; url: string }>;
  if (prs.length > 1) throw new Error('Multiple open PRs for this branch; resolve ambiguity before pushing');
  if (input.dryRun) return { dryRun: true, branch, head, repo: repo.full_name, existingPr: prs[0] ?? null };
  run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  const url = prs[0]?.url ?? run('gh', [
    'pr', 'create', '--repo', repo.full_name, '--base', repo.default_branch, '--head', branch,
    '--title', input.title, '--body', input.body
  ]).trim();
  run('gh', ['pr', 'merge', url, '--repo', repo.full_name, '--auto', '--squash', '--match-head-commit', head]);
  return { dryRun: false, branch, head, url, autoMergeRequested: true, integrated: false };
}
