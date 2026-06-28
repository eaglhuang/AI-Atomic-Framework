import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const result = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/__tests__/framework-mode-staged-residue.spec.ts')],
  {
    cwd: root,
    encoding: 'utf8',
    env: process.env
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error || result.status !== 0) {
  const detail = result.error?.message ?? `exit ${result.status ?? 1}`;
  throw new Error(`[framework-hook-scope-filtering:${mode}] ${detail}`);
}

console.log(`[framework-hook-scope-filtering:${mode}] ok (foreign planning-mirror locks no longer block staged same-task close bundles)`);
