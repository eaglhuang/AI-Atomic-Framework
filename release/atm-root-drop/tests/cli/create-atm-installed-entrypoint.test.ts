
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  writeFileSync(path.join(root, 'node_modules/create-atm/package.json'), JSON.stringify({ type: 'module', dependencies: { '@ai-atomic-framework/cli': '1.2.3' } }));
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
if (args[0] === 'bootstrap') writeFileSync(path.join(args[args.indexOf('--cwd') + 1], '.gitignore'), 'node_modules/\\n');
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
writeFileSync(${JSON.stringify(path.join(root, 'npm-args.json'))}, JSON.stringify(args));
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
    return spawnSync(process.execPath, [starter, ...args, '--cwd', root, '--json'], { encoding: 'utf8', env: { ...process.env, npm_execpath: npmCli,
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
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
      assert.equal(child.status, 0, child.stderr + child.stdout);
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, true);
      assert.equal(result.evidence.atmEntrypointSource, 'target-dependency');
      assert.equal(result.evidence.runtimeVersion, '1.2.3');
      assert.equal(result.evidence.distTag.npmPackageSpec, '@ai-atomic-framework/cli@1.2.3');
      assert.ok(JSON.parse(readFileSync(path.join(f.root, 'npm-args.json'), 'utf8')).includes('@ai-atomic-framework/cli@1.2.3'));
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

test('successful starter creates exactly one target-local initial commit', () => {
  const f = fixture();
  try {
    const child = spawnSync(process.execPath, [f.starter, 'project', '--cwd', f.root, '--json'], {
      encoding: 'utf8', env: { ...process.env, npm_execpath: path.join(f.root, 'npm-cli.js'),
        GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }
    });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const target = path.join(f.root, 'project');
    const count = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: target, encoding: 'utf8' });
    assert.equal(count.status, 0, count.stderr);
    assert.equal(count.stdout.trim(), '1');
    const tracked = spawnSync('git', ['ls-files'], { cwd: target, encoding: 'utf8' });
    assert.match(tracked.stdout, /package-lock\.json/);
    assert.doesNotMatch(tracked.stdout, /node_modules/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('explicit latest opts into the floating channel', () => {
  const f = fixture();
  try {
    const child = f.invoke(['project', '--tag', 'latest']);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).evidence.distTag.npmPackageSpec, '@ai-atomic-framework/cli@latest');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('initial commit ignores inherited Git placement and preserves the parent repository', () => {
  const f = fixture();
  const identity = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  try {
    const parentGit = (...args: string[]) => spawnSync('git', args, { cwd: f.root, encoding: 'utf8', env: { ...process.env, ...identity } });
    assert.equal(parentGit('init', '--quiet').status, 0);
    writeFileSync(path.join(f.root, '.gitignore'), 'node_modules/\nnpm-cli.js\n');
    writeFileSync(path.join(f.root, 'parent.txt'), 'parent baseline');
    assert.equal(parentGit('add', '.gitignore', 'parent.txt').status, 0);
    assert.equal(parentGit('commit', '-m', 'parent baseline').status, 0);
    const head = parentGit('rev-parse', 'HEAD').stdout;
    writeFileSync(path.join(f.root, 'parent.txt'), 'parent staged WIP');
    assert.equal(parentGit('add', 'parent.txt').status, 0);
    const staged = parentGit('diff', '--cached').stdout;
    const child = spawnSync(process.execPath, [f.starter, 'project', '--cwd', f.root, '--json'], {
      encoding: 'utf8', env: { ...process.env, ...identity, npm_execpath: path.join(f.root, 'npm-cli.js'),
        GIT_DIR: path.join(f.root, '.git'), GIT_WORK_TREE: f.root, GIT_INDEX_FILE: path.join(f.root, '.git/index') }
    });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    assert.equal(parentGit('rev-parse', 'HEAD').stdout, head);
    assert.equal(parentGit('diff', '--cached').stdout, staged);
    assert.equal(existsSync(path.join(f.root, 'project/.git')), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('missing Git identity preserves generated files without staging or a commit', () => {
  const f = fixture();
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, npm_execpath: path.join(f.root, 'npm-cli.js'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(f.root, 'absent-config') };
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete env[key];
    const child = spawnSync(process.execPath, [f.starter, 'project', '--cwd', f.root, '--json'], { encoding: 'utf8', env });
    assert.equal(child.status, 1);
    const payload = JSON.parse(child.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.messages[0].text, /Configure Git user.name and user.email/);
    const target = path.join(f.root, 'project');
    assert.equal(existsSync(path.join(target, 'package-lock.json')), true);
    const index = spawnSync('git', ['ls-files'], { cwd: target, encoding: 'utf8', env });
    assert.equal(index.stdout, '');
    assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: target, env }).status, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const declared of [undefined, '^1.2.3', 'latest']) {
  test(`invalid default dependency ${declared} fails before project creation`, () => {
    const f = fixture();
    try {
      writeFileSync(path.join(f.root, 'node_modules/create-atm/package.json'), JSON.stringify({ type: 'module', dependencies: { '@ai-atomic-framework/cli': declared } }));
      const child = f.invoke(['project']);
      assert.equal(child.status, 2);
      assert.match(child.stderr, /exact CLI dependency/);
      assert.equal(existsSync(path.join(f.root, 'project')), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('installed version mismatch fails before bootstrap', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, 'node_modules/create-atm/package.json'), JSON.stringify({ type: 'module', dependencies: { '@ai-atomic-framework/cli': '1.2.4' } }));
    const child = f.invoke(['project']);
    assert.equal(child.status, 1);
    assert.equal(JSON.parse(child.stdout).ok, false);
    assert.equal(existsSync(f.calls), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

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

