import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-skew-matrix-');

try {
  const summaryPath = path.join(tempRoot, 'skew-summary.json');
  const valid = runValidator(['--mode', 'validate', '--summary', summaryPath]);
  assert.equal(valid.exitCode, 0);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert.match(valid.stdout, new RegExp(`verified ${summary.cases.length} CLI`));
  assert.equal(summary.ok, true);
  assert.ok(summary.cases.length > 0);
  assert.equal(summary.cases.every((entry: any) => entry.status === 'pass'), true);

  const invalid = runValidator(['--mode', 'validate', '--config', 'fixtures/skew/incompatible-version.config.json']);
  assert.equal(invalid.exitCode, 1);
  assert.match(`${invalid.stdout}\n${invalid.stderr}`, /SKEW_VERSION_OUTSIDE_WINDOW/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[skew-matrix:test] ok (summary artefact + incompatible combo failure)');

function runValidator(args: readonly string[]) {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'scripts', 'validate-skew-matrix.ts'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
