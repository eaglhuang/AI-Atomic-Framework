import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCliNpmRuntime } from '../../scripts/build-cli-npm-runtime.ts';
import { withPrivateCliNpmPackage } from '../../scripts/lib/private-cli-npm-package.ts';

const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-output-'));
try {
  const cli = path.join(fixture, 'packages/cli');
  const dist = path.join(cli, 'dist');
  mkdirSync(dist, { recursive: true });
  mkdirSync(path.join(cli, 'src'), { recursive: true });
  const metadata = JSON.stringify({ name: 'atm-fixture', version: '1.0.0', type: 'module', files: ['dist/npm-runtime'],
    atmArtifactBudget: { budget: { maxPackedBytes: 100000, maxPackedEntries: 100, maxInstalledPathChars: 180 } } }) + '\n';
  writeFileSync(path.join(cli, 'package.json'), metadata);
  writeFileSync(path.join(cli, 'README.md'), 'Fixture package\n');
  writeFileSync(path.join(dist, 'index.js'), 'export const marker = true;\n');
  writeFileSync(path.join(dist, 'atm-public.js'), 'export const publicCliCommandNames = ["next"]; export const runPublicCli = () => 0;\n');
  writeFileSync(path.join(dist, 'asset.json'), '{"retained":true}\n');
  writeFileSync(path.join(cli, 'src/asset.json'), '{"retained":true}\n');
  mkdirSync(path.join(fixture, 'templates'), { recursive: true });
  writeFileSync(path.join(fixture, 'templates/atom.spec.template.json'), '{}\n');
  writeFileSync(path.join(fixture, 'templates/atom.test.template.ts'), '// fixture\n');
  const core = path.join(fixture, 'packages/core');
  mkdirSync(path.join(core, 'src/telemetry'), { recursive: true });
  writeFileSync(path.join(core, 'package.json'), '{"name":"atm-core-fixture","files":["dist"]}\n');
  writeFileSync(path.join(core, 'src/index.ts'), "export { freshDependency } from './telemetry/observed-coverage.ts';\n");
  writeFileSync(path.join(core, 'src/telemetry/observed-coverage.ts'), 'export const freshDependency = 42;\n');
  writeFileSync(path.join(cli, 'src/index.ts'), "export { freshDependency } from '../../core/src/index.ts'; export const marker = 'fresh-source';\n");
  writeFileSync(path.join(cli, 'src/atm-public.ts'), 'export const publicCliCommandNames = ["next"]; export const runPublicCli = () => 0;\n');
  mkdirSync(path.join(fixture, 'schemas'), { recursive: true });
  writeFileSync(path.join(fixture, 'schemas/fixture.schema.json'), '{"fresh":true}\n');
  writeFileSync(path.join(cli, 'src/schema-path.ts'), "export const schema = 'schemas/fixture.schema.json';\n");
  mkdirSync(path.join(dist, 'npm-runtime'), { recursive: true });
  writeFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'existing canonical output\n');
  writeFileSync(path.join(dist, 'npm-runtime/manifest.json'), '{"old":true}\n');
  const outputs = [path.join(fixture, 'private-a'), path.join(fixture, 'private-b')];
  const manifests = await Promise.all(outputs.map(outputRoot => buildCliNpmRuntime({ repositoryRoot: fixture, outputRoot })));
  assert.deepEqual(manifests[0], manifests[1]);
  assert.equal(readFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'utf8'), 'existing canonical output\n');
  assert.equal(existsSync(path.join(dist, '.npm-runtime-entry.mjs')), false);
  for (const output of outputs) {
    assert.equal((await import(pathToFileURL(path.join(output, 'runtime.mjs')).href)).marker, true);
    assert.equal(readFileSync(path.join(output, 'layout/asset.json'), 'utf8'), '{"retained":true}\n');
    assert.equal(existsSync(path.join(output, 'layout/npm-runtime/runtime.mjs')), false);
    assert.equal(existsSync(path.join(output, 'layout/npm-runtime/manifest.json')), false);
  }
  await assert.rejects(buildCliNpmRuntime({ repositoryRoot: fixture, outputRoot: dist }), /must not overlap/);
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
  let retainedPath = '';
  await assert.rejects(withPrivateCliNpmPackage(fixture, async packageRoot => {
    retainedPath = packageRoot;
    assert.equal(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'), metadata);
    assert.equal(readFileSync(path.join(packageRoot, 'README.md'), 'utf8'), 'Fixture package\n');
    assert(existsSync(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')));
    const runtime = await import(pathToFileURL(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')).href);
    assert.equal(runtime.marker, 'fresh-source');
    assert.equal(runtime.freshDependency, 42);
    assert.equal(readFileSync(path.join(packageRoot, 'dist/npm-runtime/layout/schemas/fixture.schema.json'), 'utf8'), '{"fresh":true}\n');
    throw new Error('consumer failure');
  }), /consumer failure/);
  assert.equal(existsSync(retainedPath), false);
  await withPrivateCliNpmPackage(fixture, async packageRoot => {
    retainedPath = packageRoot;
    const packArgs = ['pack', '--ignore-scripts', '--json', '--loglevel', 'silent'];
    const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const packed = JSON.parse(execFileSync(process.platform === 'win32' ? process.execPath : 'npm',
      process.platform === 'win32' ? [npmCli, ...packArgs] : packArgs,
      { cwd: packageRoot, encoding: 'utf8', windowsHide: true }));
    const packedPaths = packed[0].files.map((entry: { path: string }) => entry.path);
    assert(packedPaths.includes('package.json'));
    assert(packedPaths.includes('README.md'));
    assert(packedPaths.includes('dist/npm-runtime/runtime.mjs'));
    assert(packedPaths.includes('dist/npm-runtime/layout/asset.json'));
    assert(!packedPaths.some((name: string) => name.includes('layout/npm-runtime/')));
  });
  assert.equal(existsSync(retainedPath), false);
  assert.equal(readFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'utf8'), 'existing canonical output\n');
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
  assert.equal(existsSync(path.join(core, 'dist')), false);
  const parallelPaths = await Promise.all([0, 1].map(() => withPrivateCliNpmPackage(fixture, async packageRoot => {
    assert.equal((await import(pathToFileURL(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')).href)).freshDependency, 42);
    return packageRoot;
  })));
  assert.notEqual(parallelPaths[0], parallelPaths[1]);
  assert(parallelPaths.every(packageRoot => !existsSync(packageRoot)));
  assert.throws(() => execFileSync(process.execPath, ['--strip-types', path.resolve('scripts/build-package-dist.ts'),
    '--repository-root', fixture, '--output-root', fixture], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }), /must not overlap/);
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('[cli-npm-runtime-output-isolation] ok');
