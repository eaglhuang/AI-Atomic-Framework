import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-skew-matrix-');

try {
  const source = readFileSync(path.join(root, 'scripts', 'validate-skew-matrix.ts'), 'utf8');
  assert.match(
    source,
    /'runner-publication-disposition'/,
    'the compatibility matrix must ignore mutable runner-publication state from its host checkout'
  );

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

  const releaseRoot = path.join(tempRoot, 'release-version-fixture');
  mkdirSync(path.join(releaseRoot, 'packages', 'cli'), { recursive: true });
  writeFileSync(path.join(releaseRoot, 'compatibility-matrix.json'), JSON.stringify({
    releaseTrain: { frameworkVersion: '0.1.0', defaultChartVersion: '0.1.0', defaultTemplateVersion: '0.1.0' }
  }));
  writeFileSync(path.join(releaseRoot, 'packages', 'cli', 'package.json'), JSON.stringify({ version: '0.1.0-beta.3' }));
  writeFileSync(path.join(releaseRoot, 'release.config.json'), JSON.stringify({
    schemaVersion: 'atm.skewMatrix.v0.1',
    releaseTrain: { frameworkVersion: '0.1.0', atmChartVersion: '0.1.0', agentTemplateVersion: '0.1.0' },
    supportedMinorWindow: ['0.1'],
    axes: { cli: [{ id: 'cli-current', packagePath: 'packages/cli', version: '0.1.0' }], pluginSdk: [{ id: 'sdk-current', packagePath: 'packages/cli', version: '0.1.0' }], adapters: [{ id: 'adapter-current', packagePath: 'packages/cli', version: '0.1.0', smoke: 'validate-local-git-adapter' }] },
    cases: [{ id: 'release-injected-prerelease', cli: 'cli-current', pluginSdk: 'sdk-current', adapter: 'adapter-current', expected: 'pass' }]
  }));
  const prerelease = runValidator(['--mode', 'matrix', '--root', releaseRoot, '--config', 'release.config.json']);
  assert.equal(prerelease.exitCode, 0, `${prerelease.stdout}\n${prerelease.stderr}`);
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
