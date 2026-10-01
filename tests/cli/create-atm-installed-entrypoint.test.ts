
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

function fixture(layout = 'dist/npm-runtime', failAt = '', installFails = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-starter-entry-'));
  const starter = path.join(root, 'node_modules/create-atm/dist/index.js');
  const cli = path.join(root, 'node_modules/@ai-atomic-framework/cli');
  mkdirSync(path.dirname(starter), { recursive: true });
  mkdirSync(path.join(cli, layout), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/create-atm/package.json'), JSON.stringify({ type: 'module' }));
  const source = readFileSync(new URL('../../packages/create-atm/src/index.ts', import.meta.url), 'utf8');
  writeFileSync(starter, stripTypeScriptTypes(source));
  writeFileSync(path.join(cli, 'package.json'), JSON.stringify({
    name: '@ai-atomic-framework/cli', version: '1.2.3', type: 'module',
    exports: { '.': { import: `./${layout}/index.js` } }, bin: { atm: `${layout}/atm.mjs` }
  }));
  writeFileSync(path.join(cli, layout, 'index.js'), 'export {};');
  const calls = path.join(root, 'calls.jsonl');
  writeFileSync(path.join(cli, layout, 'atm.mjs'), `
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'integration' && args[1] === 'add' && args[2] === 'codex') {
  const corpus = path.join(args[args.indexOf('--cwd') + 1], 'integrations/codex-skills/atm-governance-router');
  mkdirSync(corpus, { recursive: true });
  writeFileSync(path.join(corpus, 'SKILL.md'), 'router-v1');
  mkdirSync(path.join(corpus, 'references'), { recursive: true });
  writeFileSync(path.join(corpus, 'references/index.md'), 'reference-v1');
}
if (args[0] === 'guide' && args[1] === 'install-skill') {
  const target = args[args.indexOf('--cwd') + 1];
  cpSync(path.join(target, 'integrations/codex-skills/atm-governance-router'), path.join(target, '.agents/skills/atm-governance-router'), { recursive: true });
}
process.exitCode = args[0] === ${JSON.stringify(failAt)} ? 7 : 0;
`);
  const npmCli = path.join(root, 'npm-cli.js');
  writeFileSync(npmCli, `
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (${JSON.stringify(installFails)}) process.exit(9);
const target = process.cwd();
cpSync(${JSON.stringify(cli)}, path.join(target, 'node_modules/@ai-atomic-framework/cli'), { recursive: true });
const manifestPath = path.join(target, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.dependencies = { '@ai-atomic-framework/cli': '1.2.3' };
writeFileSync(manifestPath, JSON.stringify(manifest));
writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@ai-atomic-framework/cli': { version: '1.2.3' } } }));
`);
  return { root, starter, calls, invoke(args: string[]) {
    return spawnSync(process.execPath, [starter, ...args, '--cwd', root, '--json'], { encoding: 'utf8', env: { ...process.env, npm_execpath: npmCli } });
  }, recorded() {
    return readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
  } };
}

test('failed runtime installation does not report ready or bootstrap', () => {
  const f = fixture('dist/npm-runtime', '', true);
  try {
    const child = f.invoke(['project', '--agent', 'codex']);
    assert.equal(child.status, 9, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.messages[0].code, 'ATM_CREATE_FAILED');
    assert.deepEqual(result.evidence.steps.map((step: { name: string }) => step.name), ['runtime install']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const layout of ['dist/npm-runtime', 'dist']) {
  test(`installed starter resolves import-only CLI exports in ${layout}`, () => {
    const f = fixture(layout);
    try {
      const child = f.invoke(['project', '--agent', 'codex']);
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, true);
      assert.equal(result.evidence.atmEntrypointSource, 'target-dependency');
      assert.equal(result.evidence.runtimeVersion, '1.2.3');
      assert.deepEqual(f.recorded().map((args) => args.slice(0, args[0] === 'bootstrap' ? 1 : 2)),
        [['bootstrap'], ['atm-chart', 'render'], ['integration', 'add'], ['guide', 'install-skill'], ['next', '--cwd']]);
      assert.equal(f.recorded()[2][2], 'codex');
      const target = path.join(f.root, 'project');
      assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).dependencies['@ai-atomic-framework/cli'], '1.2.3');
      assert.equal(readFileSync(path.join(target, '.agents/skills/atm-governance-router/SKILL.md'), 'utf8'), 'router-v1');
      assert.equal(readFileSync(path.join(target, '.agents/skills/atm-governance-router/references/index.md'), 'utf8'), 'reference-v1');
      rmSync(path.join(f.root, 'node_modules'), { recursive: true, force: true });
      const firstUse = spawnSync(process.execPath, [path.join(target, 'atm.mjs'), 'next', '--json'], { cwd: target, encoding: 'utf8' });
      assert.equal(firstUse.status, 0, firstUse.stderr);
      rmSync(path.join(target, 'node_modules'), { recursive: true, force: true });
      const missing = spawnSync(process.execPath, [path.join(target, 'atm.mjs'), 'next', '--json'], { cwd: target, encoding: 'utf8' });
      assert.notEqual(missing.status, 0);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

for (const failAt of ['bootstrap', 'atm-chart']) {
  test(`starter stops immediately after ${failAt} fails`, () => {
    const f = fixture('dist/npm-runtime', failAt);
    try {
      const child = f.invoke(['project', '--agent', 'codex']);
      assert.equal(child.status, 7, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.evidence.steps.length, failAt === 'bootstrap' ? 2 : 3);
      assert.equal(f.recorded().length, result.evidence.steps.length - 1);
      assert.equal(f.recorded().some((args) => args[0] === 'integration'), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('npm bin symlink executes help rather than silently exiting', (t) => {
  const f = fixture();
  try {
    const bin = path.join(f.root, 'create-atm');
    try { symlinkSync(f.starter, bin, 'file'); } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Windows requires symlink privileges; Linux CI executes this case');
        return;
      }
      throw error;
    }
    const child = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Usage: create-atm/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

