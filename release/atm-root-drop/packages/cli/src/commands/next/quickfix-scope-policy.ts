import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

// research/paper-v2/README.md requires corrections to use a new generation.
// Treat every committed collection/generation directory as immutable, including
// generations without a checksum manifest. Top-level indexes remain editable.
const researchRoot = 'research/paper-v2';
const sealManifest = /(?:^|[/\\])(?:SHA\d+SUMS|MD5SUMS)$/i;

export function isQuickfixSealManifestPath(entry: string): boolean {
  return sealManifest.test(entry);
}

function isExactConditionCollectionFile(relative: string): boolean {
  const parts = relative.split('/');
  return parts.length === 4 && Boolean(path.extname(relative)) && /(?:^|-)conditions$/i.test(parts[2] ?? '');
}

export function inspectQuickfixResearchScope(cwd: string, files: readonly string[]) {
  const blocked: string[] = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file.replaceAll('\\', '/'));
    let ancestor = absolute;
    while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    const canonical = path.resolve(realpathSync(ancestor), path.relative(ancestor, absolute));
    const lexical = path.relative(path.resolve(cwd), absolute).split(path.sep).join('/');
    const resolved = path.relative(realpathSync(cwd), canonical).split(path.sep).join('/');
    const toResearch = path.relative(canonical, path.join(realpathSync(cwd), researchRoot));
    if (!toResearch || (!toResearch.startsWith('..') && !path.isAbsolute(toResearch))
      || /^[*?\[]/.test(lexical)) {
      blocked.push(file);
      continue;
    }
    for (const relative of new Set([lexical, resolved])) {
      const parts = relative.split('/');
      if (!relative.startsWith(`${researchRoot}/`)) continue;
      if (/[*?\[\]{}]/.test(relative) || (existsSync(absolute) && statSync(absolute).isDirectory())) {
        blocked.push(file);
        continue;
      }
      if (parts.length < 5) {
        // Root indexes and exact condition-collection files are records, not
        // generation members. Generation members start at five segments.
        if (isExactConditionCollectionFile(relative)) continue;
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
  }
  return blocked.length ? {
    code: 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION',
    reason: 'Quickfix cannot edit or extend existing research generations. Use a new generation and update the top-level evidence index.',
    files: blocked
  } : null;
}
