import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const result = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/taskflow/__tests__/taskflow-close-atomicity.test.ts')],
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
  throw new Error(`[taskflow-close-atomicity:${mode}] ${detail}`);
}

console.log(`[taskflow-close-atomicity:${mode}] ok (same-repo planning closeback stays atomic across governed write and rollback lanes)`);
