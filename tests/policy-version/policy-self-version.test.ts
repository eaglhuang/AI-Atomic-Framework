import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- TC-0: existing baseline checks ---

const invalid = runNode(['scripts/validate-policy-self-version.ts', '--mode', 'test', '--policy', 'tests/policy-version/invalid-policy.md']);
assert.equal(invalid.exitCode, 1, invalid.output);
assert.match(invalid.output, /POLICY_VERSION_VALUE_INVALID|POLICY_VERSION_SEMVER_INVALID/);

const valid = runNode(['scripts/validate-policy-self-version.ts', '--mode', 'test']);
assert.equal(valid.exitCode, 0, valid.output);

const tempRoot = createTempWorkspace('atm-policy-version-');
const matrixPath = path.join(tempRoot, 'compatibility-matrix.json');
const diffPath = path.join(tempRoot, 'compatibility-matrix.diff.json');
writeFileSync(matrixPath, readFileSync(path.join(root, 'tests/policy-version/compatibility-matrix.fixture.json'), 'utf8'), 'utf8');

const generated = runNode([
  'scripts/generate-matrix-pr.ts',
  '--release-version', '0.1.0',
  '--matrix', matrixPath,
  '--diff-out', diffPath,
  '--write'
]);
assert.equal(generated.exitCode, 0, generated.output);
assert.equal(existsSync(diffPath), true);
const diff = JSON.parse(readFileSync(diffPath, 'utf8'));
assert.equal(diff.schemaVersion, 'atm.matrixPrDiff.v0.1');
assert.equal(diff.releaseVersion, '0.1.0');
assert.equal(diff.hasChanges, true);
assert.equal(diff.changes.some((entry: any) => entry.path === 'releaseTrain.frameworkVersion' && entry.after === '0.1.0'), true);

// --- TC-5: matrix PR diff — when frameworkVersion already matches the release,
//           only lastUpdated appears in changes (no frameworkVersion entry) ---
const matrixAlreadyAtVersionPath = path.join(tempRoot, 'already-at-version-matrix.json');
// compatibility-matrix.fixture.json has frameworkVersion "0.0.0"; request the same version
writeFileSync(matrixAlreadyAtVersionPath, readFileSync(path.join(root, 'tests/policy-version/compatibility-matrix.fixture.json'), 'utf8'), 'utf8');
const diffNoVersionPath = path.join(tempRoot, 'no-version-change.diff.json');
const noVersionChange = runNode([
  'scripts/generate-matrix-pr.ts',
  '--release-version', '0.0.0',
  '--matrix', matrixAlreadyAtVersionPath,
  '--diff-out', diffNoVersionPath
]);
assert.equal(noVersionChange.exitCode, 0, `TC-5: ${noVersionChange.output}`);
const diffNoVersion = JSON.parse(readFileSync(diffNoVersionPath, 'utf8'));
assert.equal(
  diffNoVersion.changes.some((entry: any) => entry.path === 'releaseTrain.frameworkVersion'),
  false,
  'TC-5: frameworkVersion must NOT appear in changes when version already matches'
);

// --- TC-6: wrong framework_version_range is rejected with POLICY_FRAMEWORK_RANGE_VALUE_INVALID ---
// Fixture has framework_version_range: ">=2.0.0 <3.0.0" which is outside the 0.x active train
const wrongRange = runNode(['scripts/validate-policy-self-version.ts', '--mode', 'test', '--policy', 'tests/policy-version/wrong-range-policy.md']);
assert.equal(wrongRange.exitCode, 1, `TC-6: ${wrongRange.output}`);
assert.match(wrongRange.output, /POLICY_FRAMEWORK_RANGE_VALUE_INVALID/, 'TC-6: wrong range must report POLICY_FRAMEWORK_RANGE_VALUE_INVALID');

console.log('[policy-self-version-test] ok');

function runNode(args: readonly string[]) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', ...args.map((arg, index) => index === 0 ? path.join(root, arg) : arg)], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`.trim()
  };
}