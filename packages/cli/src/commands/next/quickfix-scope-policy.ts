import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

// research/paper-v2/README.md requires corrections to use a new generation.
// Treat every committed collection/generation directory as immutable, including
// generations without a checksum manifest. Top-level indexes remain editable.
const researchRoot = 'research/paper-v2';

export function inspectQuickfixResearchScope(cwd: string, files: readonly string[]) {
  const blocked: string[] = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file.replaceAll('\\', '/'));
    let ancestor = absolute;
    while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    const canonical = path.resolve(realpathSync(ancestor), path.relative(ancestor, absolute));
    const lexical = path.relative(path.resolve(cwd), absolute).split(path.sep).join('/');
    const relative = (lexical.startsWith(`${researchRoot}/`) ? lexical
      : path.relative(realpathSync(cwd), canonical).split(path.sep).join('/'));
    const toResearch = path.relative(canonical, path.join(realpathSync(cwd), researchRoot));
    if (!toResearch || (!toResearch.startsWith('..') && !path.isAbsolute(toResearch))
      || /^[*?\[]/.test(relative)) {
      blocked.push(file);
      continue;
    }
    const parts = relative.split('/');
    if (!relative.startsWith(`${researchRoot}/`)) continue;
    if (/[*?\[\]{}]/.test(relative) || (existsSync(absolute) && statSync(absolute).isDirectory())) {
      blocked.push(file);
      continue;
    }
    if (parts.length < 5) {
      // Only exact files may enter this bounded channel; root index files are OK.
      if (parts.length !== 3 || !path.extname(relative)) blocked.push(file);
      continue;
    }
    const generation = parts.slice(0, 4).join('/');
    const tree = spawnSync('git', ['ls-tree', '--name-only', 'HEAD', '--', generation], {
      cwd, encoding: 'utf8', timeout: 5000
    });
    if (tree.status !== 0) return {
      code: 'ATM_QUICKFIX_RESEARCH_SEAL_INSPECTION_FAILED',
      reason: 'Cannot verify committed research generation boundaries. Inspect Git HEAD before retrying the exact scope.', files
    };
    if (tree.stdout.trim()) blocked.push(file);
  }
  return blocked.length ? {
    code: 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION',
    reason: 'Quickfix cannot edit or extend existing research generations. Use a new generation and update the top-level evidence index.',
    files: blocked
  } : null;
}
