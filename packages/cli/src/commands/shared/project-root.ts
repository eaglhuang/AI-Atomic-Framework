import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * An agent that `cd`s into a subdirectory (for example `src/`) and runs
 * `node ../atm.mjs next` must not be told the repository needs bootstrap: that
 * advice creates a second, nested ATM install. When the command did not name a
 * different directory, move to the nearest ancestor that holds
 * `.atm/config.json`, bounded by the enclosing Git work tree so a nested,
 * independent repository is never redirected into its parent.
 *
 * Returns the directory the command should run in, or null to keep cwd.
 */
export function resolveAtmProjectRoot(startDirectory: string): string | null {
  const start = path.resolve(startDirectory);
  if (existsSync(path.join(start, '.atm', 'config.json'))) return null;
  const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (topLevel.status !== 0) return null;
  const boundary = path.resolve(topLevel.stdout.trim());
  let current = start;
  while (current !== boundary && isWithin(boundary, current)) {
    current = path.dirname(current);
    if (existsSync(path.join(current, '.atm', 'config.json'))) return current;
  }
  return null;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Apply the project-root redirect for a CLI invocation. Only runs when the
 * invocation left the directory implicit (no `--cwd`) or pointed `--cwd` at
 * the process directory itself (`--cwd .`, as many printed commands do).
 */
export function applyProjectRootRedirect(argv: readonly string[]): string | null {
  const cwdIndex = argv.indexOf('--cwd');
  const explicit = cwdIndex >= 0 ? argv[cwdIndex + 1] : undefined;
  if (explicit !== undefined && path.resolve(explicit) !== path.resolve(process.cwd())) return null;
  const root = resolveAtmProjectRoot(process.cwd());
  if (!root) return null;
  process.chdir(root);
  return root;
}
