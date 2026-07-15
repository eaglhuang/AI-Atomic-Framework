import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  return readFileSync(absolutePath, 'utf8');
}

const commitBundleAssembly = read('packages/cli/src/commands/taskflow/commit-bundle-assembly.ts');
const commitBundleSpec = read('packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts');
const crashMatrixSpec = read('packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts');
const runnerSyncSpec = read('tests/cli/runner-sync-foreign-dirty-owner.test.ts');
const validatorCatalog = read('scripts/validators.config.json');

assert.match(commitBundleAssembly, /withCloseTransactionMutex/);
assert.match(commitBundleSpec, /closeTransactionMutexPath/);
assert.match(commitBundleSpec, /atm\.closeTransactionMutexLease\.v1/);

assert.match(crashMatrixSpec, /makeKillAfterTargetCommitFixture/);
assert.match(crashMatrixSpec, /terminateProcessTree/);
assert.match(crashMatrixSpec, /kill-after-target commit should converge dirty planning closeback/);
assert.match(crashMatrixSpec, /historical-delivery/);

assert.match(runnerSyncSpec, /foreignNonReleaseWip/);
assert.match(runnerSyncSpec, /ordinaryTaskReleaseAutoStageAllowed/);
assert.match(runnerSyncSpec, /releaseWip/);

const validators = JSON.parse(validatorCatalog) as {
  readonly validators?: ReadonlyArray<{ readonly name?: string; readonly entry?: string; readonly tags?: readonly string[] }>;
};
const gate = validators.validators?.find((entry) => entry.name === 'pre-team-foundation-gate');
assert.equal(gate?.entry, 'tests/cli/pre-team-foundation-gate.test.ts');
assert.ok(gate?.tags?.includes('foundation-gate'));
assert.ok(gate?.tags?.includes('team'));
assert.ok(gate?.tags?.includes('taskflow'));

console.log('[pre-team-foundation-gate] ok');
