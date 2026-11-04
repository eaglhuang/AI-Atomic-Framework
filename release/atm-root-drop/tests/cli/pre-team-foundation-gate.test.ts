import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  return readFileSync(absolutePath, 'utf8');
}

// Each sub-test builds its own mkdtemp fixture and only reads the repo, so they
// run concurrently; the gate still requires every one to exit 0.
function runTest(relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--strip-types', absolutePath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        assert.equal(status, 0, `${relativePath} must pass directly, not via source-text inspection\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

const validatorCatalog = read('scripts/validators.config.json');

await Promise.all([
  runTest('tests/cli/pre-team-dual-captain-e2e.test.ts'),
  runTest('packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts'),
  runTest('packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts'),
  runTest('tests/cli/runner-sync-foreign-dirty-owner.test.ts'),
  runTest('tests/cli/runner-sync-framework-temp-hotfix.test.ts')
]);

const validators = JSON.parse(validatorCatalog) as {
  readonly validators?: ReadonlyArray<{ readonly name?: string; readonly entry?: string; readonly tags?: readonly string[] }>;
};
const gate = validators.validators?.find((entry) => entry.name === 'pre-team-foundation-gate');
assert.equal(gate?.entry, 'tests/cli/pre-team-foundation-gate.test.ts');
assert.ok(gate?.tags?.includes('foundation-gate'));
assert.ok(gate?.tags?.includes('team'));
assert.ok(gate?.tags?.includes('taskflow'));

console.log('[pre-team-foundation-gate] ok');
