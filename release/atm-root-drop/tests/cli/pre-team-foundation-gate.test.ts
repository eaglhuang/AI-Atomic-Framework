import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  return readFileSync(absolutePath, 'utf8');
}

function runTest(relativePath: string): void {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  const result = spawnSync(process.execPath, ['--strip-types', absolutePath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    result.status,
    0,
    `${relativePath} must pass directly, not via source-text inspection\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

const validatorCatalog = read('scripts/validators.config.json');

runTest('tests/cli/pre-team-dual-captain-e2e.test.ts');
runTest('packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts');
runTest('packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts');
runTest('tests/cli/runner-sync-foreign-dirty-owner.test.ts');

const validators = JSON.parse(validatorCatalog) as {
  readonly validators?: ReadonlyArray<{ readonly name?: string; readonly entry?: string; readonly tags?: readonly string[] }>;
};
const gate = validators.validators?.find((entry) => entry.name === 'pre-team-foundation-gate');
assert.equal(gate?.entry, 'tests/cli/pre-team-foundation-gate.test.ts');
assert.ok(gate?.tags?.includes('foundation-gate'));
assert.ok(gate?.tags?.includes('team'));
assert.ok(gate?.tags?.includes('taskflow'));

console.log('[pre-team-foundation-gate] ok');
