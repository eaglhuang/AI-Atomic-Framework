import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synchronizeReleaseWorkspaceVersions } from '../../scripts/set-release-workspace-versions.ts';
import { releaseVersionSourcesAreCompatible } from '../../scripts/lib/release-version-compatibility.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-release-workspace-versions-'));

function writeManifest(directory: string, manifest: object): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

try {
  writeManifest(path.join(root, 'packages', 'core'), { name: '@scope/core', version: '0.1.0' });
  mkdirSync(path.join(root, 'packages', 'generated'), { recursive: true });
  writeManifest(path.join(root, 'packages', 'cli'), {
    name: '@scope/cli',
    version: '0.1.0',
    dependencies: { '@scope/core': '0.1.0', external: '^2.0.0' },
    optionalDependencies: { '@scope/core': '^0.1.0' },
    peerDependencies: { '@scope/core': 'workspace:*' },
    devDependencies: { '@scope/core': '0.1.0' }
  });

  const changed = synchronizeReleaseWorkspaceVersions(root, '0.1.0-beta.0');
  assert.deepEqual(changed, ['packages/cli/package.json']);

  const cli = JSON.parse(readFileSync(path.join(root, 'packages', 'cli', 'package.json'), 'utf8'));
  assert.equal(cli.dependencies['@scope/core'], '0.1.0-beta.0');
  assert.equal(cli.optionalDependencies['@scope/core'], '0.1.0-beta.0');
  assert.equal(cli.peerDependencies['@scope/core'], '0.1.0-beta.0');
  assert.equal(cli.dependencies.external, '^2.0.0');
  assert.equal(cli.devDependencies['@scope/core'], '0.1.0');

  assert.deepEqual(synchronizeReleaseWorkspaceVersions(root, '0.1.0-beta.0'), [], 'second pass must be idempotent');
  const matrixPath = path.join(root, 'compatibility-matrix.json');
  const matrix = { releaseTrain: { frameworkVersion: '0.1.0', defaultChartVersion: '0.1.0' }, supported: ['keep'] };
  writeFileSync(matrixPath, JSON.stringify(matrix), 'utf8');
  assert.equal(releaseVersionSourcesAreCompatible({ releaseTag: 'v0.1.3', rootPackageVersion: '0.1.3', releaseTrainVersion: '0.1.0' }), false);
  assert.ok(synchronizeReleaseWorkspaceVersions(root, '0.1.3').includes('compatibility-matrix.json'));
  const projected = JSON.parse(readFileSync(matrixPath, 'utf8'));
  assert.equal(projected.releaseTrain.frameworkVersion, '0.1.3');
  assert.equal(projected.releaseTrain.defaultChartVersion, '0.1.0');
  assert.deepEqual(projected.supported, ['keep']);
  assert.equal(releaseVersionSourcesAreCompatible({ releaseTag: 'v0.1.3', rootPackageVersion: '0.1.3', releaseTrainVersion: projected.releaseTrain.frameworkVersion }), true);
  assert.deepEqual(synchronizeReleaseWorkspaceVersions(root, '0.1.3'), []);
  synchronizeReleaseWorkspaceVersions(root, '0.1.4-beta.0');
  assert.equal(JSON.parse(readFileSync(matrixPath, 'utf8')).releaseTrain.frameworkVersion, '0.1.4');
  assert.throws(() => synchronizeReleaseWorkspaceVersions(root, 'invalid'), /valid release version/);
  const workflow = readFileSync(new URL('../../.github/workflows/release-npm.yml', import.meta.url), 'utf8');
  const compatibilityStep = workflow.split('- name: Validate release version compatibility')[1]?.split('- name:')[0] ?? '';
  assert.ok(!compatibilityStep.includes('if:'), 'dry-run must execute the same release compatibility gate');
  assert.ok(compatibilityStep.includes('$ATM_RELEASE_TAG'), 'dry-run must validate its simulated release version');
  console.log('[release-workspace-versions:test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
