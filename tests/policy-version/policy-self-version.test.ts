import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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