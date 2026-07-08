import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function runFocusedTest(relativePath: string) {
  const result = spawnSync(
    process.execPath,
    ['--strip-types', path.join(root, relativePath)],
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
    throw new Error(`[taskflow-close-atomicity:${mode}] ${relativePath} failed: ${detail}`);
  }
}

runFocusedTest('packages/cli/src/commands/taskflow/__tests__/taskflow-close-atomicity.test.ts');
// ATM-BUG-2026-07-07-049 / ATM-BUG-2026-07-07-046: commit-bundle-assembly.ts backs
// the same close-write commit lane this validator otherwise exercises end-to-end;
// its focused spec is the only regression coverage for post-commit live-index
// residue and actor-scoped commit identity, so it must gate alongside atomicity.
runFocusedTest('packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts');
// ATM-BUG-2026-07-07-050: dry-run/--write closeback-path parity regression lives
// alongside the other write-readiness blockers this hint builder computes.
runFocusedTest('packages/cli/src/commands/taskflow/__tests__/write-readiness.spec.ts');

console.log(`[taskflow-close-atomicity:${mode}] ok (same-repo planning closeback stays atomic across governed write and rollback lanes; commit-bundle-assembly residue/identity and write-readiness dry-run parity regressions covered)`);
