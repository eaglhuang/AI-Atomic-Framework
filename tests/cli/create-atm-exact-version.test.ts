import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExactCliVersion } from '../../packages/create-atm/src/index.ts';
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-exact-version-'));
const entry = fileURLToPath(new URL('../../packages/create-atm/src/index.ts', import.meta.url));
let cases = 0;

function selectionFixture(declared: string, sourceTree = false) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-version-selection-'));
  const starterRoot = path.join(cwd, sourceTree ? 'packages/create-atm' : 'node_modules/create-atm');
  const starter = path.join(starterRoot, sourceTree ? 'src/index.mjs' : 'dist/index.js');
  mkdirSync(path.dirname(starter), { recursive: true });
  writeFileSync(path.join(starterRoot, 'package.json'), JSON.stringify({ type: 'module', dependencies: { '@ai-atomic-framework/cli': declared } }));
  writeFileSync(starter, stripTypeScriptTypes(readFileSync(entry, 'utf8')));
  if (sourceTree) writeFileSync(path.join(cwd, 'atm.mjs'), 'process.exitCode = 0;');
  else {
    const cli = path.join(cwd, 'node_modules/@ai-atomic-framework/cli');
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    writeFileSync(path.join(cli, 'index.js'), 'export {};');
    writeFileSync(path.join(cli, 'atm.mjs'), 'process.exitCode = 0;');
  }
  const npmCli = path.join(cwd, 'npm-cli.js');
  const recorded = path.join(cwd, 'npm-args.json');
  writeFileSync(npmCli, `require('node:fs').writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(process.argv.slice(2))); process.exit(9);`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { npm_execpath: npmCli, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
  return { cwd, recorded, invoke(args: string[]) {
    return spawnSync(process.execPath, [starter, 'project', '--cwd', cwd, '--json', ...args], { encoding: 'utf8', env });
  } };
}

try {
  for (const [version, tag] of [['1.2.3', 'latest'], ['1.2.3-beta.0', 'next'], ['1.2.3-alpha.1', 'beta'], ['1.2.3-lts.2', 'lts'], ['1.2.3', 'lts']] as const) {
    assert.equal(parseExactCliVersion(version, tag), version); cases++;
  }
  for (const value of ['latest', 'next', '*', '^1.2.3', '~1.2.3', '>=1.2.3', '1.2', 'v1.2.3', '01.2.3', '1.2.3-beta.01', 'file:other', '../other', 'https://example.invalid/pkg.tgz', '@scope/name@1.2.3', '--registry', '1.2.3;echo bad', '1.2.3 --registry=x']) {
    const run = spawnSync(process.execPath, ['--strip-types', entry, 'project', '--cwd', root, '--cli-version', value, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 2, value); assert.equal(existsSync(path.join(root, 'project')), false, `invalid value must fail before target writes: ${value}`); cases++;
  }
  for (const [value, tag] of [['1.2.3-beta.0', 'latest'], ['1.2.3', 'next'], ['1.2.3-beta.1', 'beta'], ['1.2.3-alpha.1', 'lts']]) {
    const run = spawnSync(process.execPath, ['--strip-types', entry, 'project', '--cwd', root, '--tag', tag, '--cli-version', value, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 2); assert.equal(existsSync(path.join(root, 'project')), false); cases++;
  }
  for (const args of [['--cli-version=1.2.3'], ['--cli-version', '1.2.3', '--cli-version', '1.2.3']]) {
    const run = spawnSync(process.execPath, ['--strip-types', entry, 'project', '--cwd', root, ...args, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 2); assert.equal(existsSync(path.join(root, 'project')), false); cases++;
  }
  const selections = [
    { declared: '1.2.3', args: [], expected: '1.2.3' },
    { declared: '1.2.3-beta.4', args: [], expected: '1.2.3-beta.4' },
    { declared: 'invalid', args: ['--tag', 'latest'], expected: 'latest' },
    { declared: '1.2.3', args: ['--tag', 'next'], expected: 'next' },
    { declared: 'invalid', args: ['--cli-version', '2.0.0'], expected: '2.0.0' },
    { declared: '1.2.3', args: ['--tag', 'next', '--cli-version', '2.0.0-beta.2'], expected: '2.0.0-beta.2' },
    { declared: '1.2.3', args: ['--cli-version', '2.0.0'], expected: '2.0.0', sourceTree: true }
  ];
  for (const selection of selections) {
    const f = selectionFixture(selection.declared, selection.sourceTree);
    try {
      const run = f.invoke(selection.args);
      assert.equal(run.status, 9, run.stderr + run.stdout);
      const args = JSON.parse(readFileSync(f.recorded, 'utf8'));
      assert.equal(args.at(-1), `@ai-atomic-framework/cli@${selection.expected}`);
      assert.deepEqual(args.slice(0, -1), ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund']);
      cases++;
    } finally { rmSync(f.cwd, { recursive: true, force: true }); }
  }
  const invalidDefault = selectionFixture('^1.2.3');
  try {
    const run = invalidDefault.invoke([]);
    assert.equal(run.status, 2); assert.equal(existsSync(path.join(invalidDefault.cwd, 'project')), false);
    assert.equal(existsSync(invalidDefault.recorded), false); cases++;
  } finally { rmSync(invalidDefault.cwd, { recursive: true, force: true }); }
  const sourceDefault = selectionFixture('1.2.3', true);
  try {
    const run = sourceDefault.invoke([]);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.equal(JSON.parse(run.stdout).evidence.atmEntrypointSource, 'source-tree');
    assert.equal(existsSync(sourceDefault.recorded), false); cases++;
  } finally { rmSync(sourceDefault.cwd, { recursive: true, force: true }); }
  console.log(`create-atm exact version: ${cases} cases passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
