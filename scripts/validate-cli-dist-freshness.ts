// Fails when the committed packages/cli/dist differs from a fresh sealed-runner package build of the same commit.
// Usage: node --strip-types scripts/validate-cli-dist-freshness.ts [--ref <commit>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { treeFiles } from './release-artifact-manifest.ts';

const repo = process.cwd();
const DIST = 'packages/cli/dist';
const run = (cwd: string, cmd: string, args: string[]) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 });
const refIndex = process.argv.indexOf('--ref');
const sha = run(repo, 'git', ['rev-parse', '--verify', `${refIndex > 0 ? process.argv[refIndex + 1] : 'HEAD'}^{commit}`]).trim();
const worktree = path.join(repo, '.atm-temp', 'cli-dist-freshness', `${process.pid}-${sha.slice(0, 12)}`);
// Declarations follow the local tsc incremental cache, and identity fields change with every commit,
// so neither says whether the runtime in dist matches its sources.
const skipped = (rel: string) => rel.endsWith('.d.ts');
const VOLATILE = new Set(['sourceCommit', 'sourceDigest', 'buildId']);
function fingerprint(rel: string, bytes: Buffer): string {
  const json = () => JSON.parse(bytes.toString('utf8'));
  if (rel.endsWith('build-identity.json')) {
    const identity = json();
    identity.files = (identity.files ?? []).filter((file: { path: string }) => !skipped(file.path));
    return JSON.stringify(identity, (key, value) => VOLATILE.has(key) ? undefined : value);
  }
  if (rel === 'npm-runtime/manifest.json') return JSON.stringify(json(), (key, value) => value?.path === 'build-identity.json' ? { path: value.path } : value);
  return createHash('sha256').update(bytes).digest('hex');
}
const snapshot = (rels: string[]) => new Map(rels.filter((rel) => !skipped(rel)).map((rel) => [rel, fingerprint(rel, readFileSync(path.join(worktree, DIST, rel)))]));
mkdirSync(path.dirname(worktree), { recursive: true });
run(repo, 'git', ['worktree', 'add', '--quiet', '--detach', worktree, sha]);
try {
  if (existsSync(path.join(repo, 'node_modules'))) symlinkSync(path.join(repo, 'node_modules'), path.join(worktree, 'node_modules'), 'dir');
  const committed = snapshot(run(worktree, 'git', ['ls-files', DIST]).split('\n').filter(Boolean).map((file) => file.slice(DIST.length + 1)));
  run(worktree, process.execPath, ['--strip-types', 'scripts/run-sealed-runner-build.ts', 'packages', '--inner']);
  const rebuilt = snapshot(treeFiles(path.join(worktree, DIST)).map((file) => path.relative(path.join(worktree, DIST), file).replaceAll('\\', '/')));
  const problems: string[] = [];
  for (const [rel, print] of committed) {
    if (!rebuilt.has(rel)) problems.push(`stale (no longer built): ${rel}`);
    else if (rebuilt.get(rel) !== print) problems.push(`differs from rebuild: ${rel}`);
  }
  for (const rel of rebuilt.keys()) if (!committed.has(rel) && !rel.endsWith('.spec.js')) problems.push(`missing (built but not committed): ${rel}`);
  if (problems.length > 0) {
    console.error(`${DIST} is stale at ${sha.slice(0, 12)} (${problems.length} problems). Rebuild it with the sealed runner build and commit all of ${DIST}; new files need git add -f because dist/ is gitignored.`);
    for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
    process.exitCode = 1;
  } else console.log(`${DIST} matches a fresh package build of ${sha.slice(0, 12)} (${committed.size} runtime files checked).`);
} finally {
  rmSync(path.join(worktree, 'node_modules'), { force: true });
  run(repo, 'git', ['worktree', 'remove', '--force', worktree]);
}
