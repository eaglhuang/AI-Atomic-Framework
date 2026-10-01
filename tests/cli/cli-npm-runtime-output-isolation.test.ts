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
  writeFileSync(path.join(cli, 'src/index.ts'), 'export const marker = true;\n');
  const metadata = '{"name":"atm-fixture","version":"1.0.0","files":["dist/npm-runtime"]}\n';
  writeFileSync(path.join(cli, 'package.json'), metadata);
  writeFileSync(path.join(cli, 'README.md'), 'Fixture package\n');
  writeFileSync(path.join(dist, 'index.js'), 'export const marker = true;\n');
  writeFileSync(path.join(dist, 'atm-public.js'), 'export const publicCliCommandNames = ["next"]; export const runPublicCli = () => 0;\n');
  writeFileSync(path.join(dist, 'asset.json'), '{"retained":true}\n');
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
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('[cli-npm-runtime-output-isolation] ok');

