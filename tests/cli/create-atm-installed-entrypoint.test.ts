import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function fixture(layout = 'dist/npm-runtime', failAt = '') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-starter-entry-'));
  const starter = path.join(root, 'node_modules/create-atm/dist/index.js');
  const cli = path.join(root, 'node_modules/@ai-atomic-framework/cli');
  mkdirSync(path.dirname(starter), { recursive: true });
  mkdirSync(path.join(cli, layout), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/create-atm/package.json'), JSON.stringify({ type: 'module' }));
  const source = readFileSync(new URL('../../packages/create-atm/src/index.ts', import.meta.url), 'utf8');
  writeFileSync(starter, transformSync(source, { loader: 'ts', format: 'esm', target: 'node24' }).code);
  writeFileSync(path.join(cli, 'package.json'), JSON.stringify({
    name: '@ai-atomic-framework/cli', type: 'module',
    exports: { '.': { import: `./${layout}/index.js` } }, bin: { atm: `${layout}/atm.mjs` }
  }));
  writeFileSync(path.join(cli, layout, 'index.js'), 'export {};');
  const calls = path.join(root, 'calls.jsonl');
  writeFileSync(path.join(cli, layout, 'atm.mjs'), `
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
process.exitCode = args[0] === ${JSON.stringify(failAt)} ? 7 : 0;
`);
  return { root, starter, calls, invoke(args: string[]) {
    return spawnSync(process.execPath, [starter, ...args, '--cwd', root, '--json'], { encoding: 'utf8' });
  }, recorded() {
    return readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
  } };
}

for (const layout of ['dist/npm-runtime', 'dist']) {
  test(`installed starter resolves import-only CLI exports in ${layout}`, () => {
    const f = fixture(layout);
    try {
      const child = f.invoke(['project', '--agent', 'codex']);
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, true);
      assert.equal(result.evidence.atmEntrypointSource, 'packaged-dependency');
      assert.deepEqual(f.recorded().map((args) => args.slice(0, args[0] === 'bootstrap' ? 1 : 2)),
        [['bootstrap'], ['atm-chart', 'render'], ['integration', 'add']]);
      assert.equal(f.recorded()[2][2], 'codex');
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
      assert.equal(result.evidence.steps.length, failAt === 'bootstrap' ? 1 : 2);
      assert.equal(f.recorded().length, result.evidence.steps.length);
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
