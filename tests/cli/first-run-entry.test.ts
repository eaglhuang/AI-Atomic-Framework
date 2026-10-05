import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import fs, { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createFirstRunContract, resolveFirstRunRuntime, rootHelpSubcommand } from '../../packages/cli/src/commands/first-run.ts';
import { inspectFirstRunTarget } from '../../packages/cli/src/commands/first-run/target-state.ts';
import { inspectFrameworkIdentity } from '../../packages/core/src/project/framework-identity.ts';
import { selectDefaultSkillInstallProfile } from '../../packages/integrations-core/src/distribution/install-profile.ts';
import { ensureAdopterTaskflowProfile } from '../../packages/cli/src/commands/bootstrap-taskflow-profile.ts';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { decideGuidanceRoute, probeProject } from '../../packages/core/src/guidance/index.ts';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sourceRunner = path.join(root, 'packages/cli/src/atm-public.ts');
const runtime = resolveFirstRunRuntime(['setup', 'bootstrap', 'next', 'doctor', 'taskflow', 'integration'], pathToFileURL(sourceRunner).href, sourceRunner, {});

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atm-first-run-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}
function put(dir: string, file: string, content: unknown) {
  const target = path.join(dir, file); mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
}
function initialized(dir: string) {
  put(dir, '.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, frameworkVersion: '0.0.1' });
  put(dir, '.atm/runtime/profile/default.md', '# Profile');
  put(dir, '.atm/runtime/project-probe.json', { schemaVersion: 'atm.projectProbe.v0.1' });
  put(dir, '.atm/runtime/default-guards.json', { schemaId: 'atm.defaultGuards' });
  put(dir, '.atm/runtime/budget/default-policy.json', { policyId: 'default-policy' });
  ensureAdopterTaskflowProfile(dir);
}
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => { const file = path.join(entry.parentPath, entry.name); return [path.relative(dir, file), createHash('sha256').update(readFileSync(file)).digest('hex')]; }));
}
function first(dir: string, flags: string[] = []) { return createFirstRunContract(['--cwd', dir, '--prompt', 'Build a small static website', ...flags], runtime); }

test('fresh static site needs no package.json, profile, global mutation, or atom route', t => {
  const dir = fixture(t); put(dir, 'index.html', '<h1>Owned by user</h1>');
  const before = snapshot(dir); const result = first(dir, ['--agents', 'codex,cursor']);
  assert.equal(result.target.state, 'uninitialized'); assert.equal(result.target.identity?.kind, 'adopter');
  assert.equal(result.nextAction?.args[1], 'setup'); assert.ok(result.nextAction?.args.includes('--dry-run'));
  assert.equal(result.nextAction?.cwd, dir); assert.equal(result.authority, 'advisory-only');
  assert.deepEqual(snapshot(dir), before); assert.ok(!JSON.stringify(result).includes('create-atom'));
});

test('no target or agent selection is guessed', () => {
  assert.equal(createFirstRunContract([], runtime).target.state, 'selection-required');
  assert.equal(createFirstRunContract([], runtime).nextAction, null);
  assert.equal(rootHelpSubcommand(['--cwd', '/target', '--prompt', 'user request', '--json']), undefined);
  assert.equal(rootHelpSubcommand(['next', '--cwd', '/target']), 'next');
});

test('initialized adopter preserves exact request argv and shared absolute runner for two targets', t => {
  const one = fixture(t), two = fixture(t); initialized(one); initialized(two);
  const prompt = 'Build "news" site; $(do-not-execute)\nusing content';
  for (const dir of [one, two]) {
    const before = snapshot(dir); const result = createFirstRunContract(['--cwd', dir, '--prompt', prompt], runtime);
    assert.equal(result.target.state, 'ready'); assert.equal(result.nextAction?.args[1], 'next');
    assert.equal(result.nextAction?.args[0], sourceRunner); assert.equal(result.nextAction?.args.at(-1), prompt);
    assert.equal(result.nextAction?.cwd, dir); assert.equal(result.versionRelation, 'different');
    assert.deepEqual(snapshot(dir), before);
  }
});

test('official bootstrap creates initialization shape and missing profile uses official setup preview', async t => {
  const dir = fixture(t);
  const boot = await runBootstrap(['--cwd', dir]); assert.equal(boot.ok, true);
  assert.equal(first(dir).target.state, 'ready');
  rmSync(path.join(dir, 'taskflow.profile.json'));
  const partial = first(dir, ['--agents', 'none']);
  assert.equal(partial.target.state, 'partial'); assert.ok(partial.target.missing.includes('taskflow.profile.json'));
  assert.equal(partial.nextAction?.args[1], 'setup'); assert.equal(partial.nextAction?.readOnly, true);
});

test('partially initialized metadata is preserved and not sent to direct bootstrap', t => {
  const dir = fixture(t); put(dir, '.atm/runtime/owned.txt', 'preserve me');
  const before = snapshot(dir); const result = first(dir, ['--agents', 'none']);
  assert.equal(result.target.state, 'partial'); assert.equal(result.nextAction?.args[1], 'setup');
  assert.ok(result.nextAction?.args.includes('--dry-run')); assert.deepEqual(snapshot(dir), before);
});

for (const [label, config] of Object.entries({ malformed: '{', null: 'null', array: '[]', empty: '{}',
  stringLayout: { schemaVersion: 'atm.config.v0.1', layoutVersion: '2' }, futureLayout: { schemaVersion: 'atm.config.v0.1', layoutVersion: 99 },
  missingSchema: { layoutVersion: 2 }, invalidVersion: { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, frameworkVersion: 7 } })) {
  test(`invalid config (${label}) is a bounded read-only diagnostic, not setup or next`, t => {
    const dir = fixture(t); put(dir, '.atm/config.json', config);
    const result = first(dir); assert.equal(result.target.state, 'invalid-config');
    assert.equal(result.nextAction?.args[1], 'doctor'); assert.equal(result.nextAction?.readOnly, true);
  });
}

test('invalid profile is preserved and no contents or secrets are projected', t => {
  const dir = fixture(t); initialized(dir); put(dir, 'taskflow.profile.json', { privateValue: 'DO-NOT-EXPOSE' });
  const before = snapshot(dir); const result = first(dir);
  assert.equal(result.target.state, 'invalid-config'); assert.ok(!JSON.stringify(result).includes('DO-NOT-EXPOSE'));
  assert.deepEqual(snapshot(dir), before);
});

for (const entry of ['.atm', '.atm/config.json', '.atm/runtime', 'taskflow.profile.json']) {
  test(`symlinked metadata ${entry} never receives an executable route`, t => {
    const dir = fixture(t), other = fixture(t); initialized(dir); initialized(other);
    rmSync(path.join(dir, entry), { recursive: true, force: true });
    symlinkSync(path.join(other, entry), path.join(dir, entry));
    const result = first(dir, ['--agents', 'none']);
    assert.equal(result.target.state, 'unsafe-target'); assert.equal(result.nextAction, null);
  });
}

test('symlinked target/parent and configured global agent roots remain blocked', t => {
  const dir = fixture(t), actual = fixture(t); symlinkSync(actual, path.join(dir, 'alias'));
  assert.equal(first(path.join(dir, 'alias')).nextAction, null);
  mkdirSync(path.join(actual, 'project'));
  assert.equal(first(path.join(dir, 'alias/project')).target.state, 'unsafe-target');
  assert.equal(inspectFirstRunTarget(actual, dir, { CODEX_HOME: actual }).state, 'unsafe-target');
  assert.equal(inspectFirstRunTarget(path.join(actual, 'project'), dir, { CLAUDE_CONFIG_DIR: actual }).state, 'unsafe-target');
});

test('framework classification uses independent markers and does not weaken conservative guard identity', t => {
  const dir = fixture(t); put(dir, 'package.json', { name: 'ai-atomic-framework', workspaces: ['packages/*'] });
  assert.equal(inspectFrameworkIdentity(dir).kind, 'ambiguous'); assert.equal(first(dir).nextAction, null);
  assert.equal(selectDefaultSkillInstallProfile({ repositoryRoot: dir }), 'adopter-bootstrap');
  put(dir, 'packages/core/src/index.ts', 'export {};'); put(dir, 'packages/cli/src/atm.ts', 'export {};');
  assert.equal(inspectFrameworkIdentity(dir).kind, 'framework');
  assert.equal(selectDefaultSkillInstallProfile({ repositoryRoot: dir }), 'framework-full');
  assert.equal(selectDefaultSkillInstallProfile({ repositoryRoot: dir, targetScope: 'adopter' }), 'adopter-bootstrap');
  put(dir, 'release-manifest.json', { schemaVersion: 'atm.rootDropRelease.v0.4' });
  assert.equal(inspectFrameworkIdentity(dir).isFrameworkRepo, true, 'a manifest cannot downgrade framework guard authority');
});

test('npm adopter runtime never proposes absent framework-mode for framework target', () => {
  const result = first(root);
  assert.equal(result.target.identity?.kind, 'framework'); assert.equal(result.nextAction, null);
  assert.ok(result.requires.some(text => text.includes('lacks framework-mode')));
  assert.equal(Object.hasOwn(result.runtime.commands, 'framework-mode'), false);
});

test('legacy command surface is authoritative even with newer version text', t => {
  const dir = fixture(t);
  const legacy = { ...runtime, version: '999.0.0', commands: { bootstrap: ['--cwd', '--json'] } };
  const result = createFirstRunContract(['--cwd', dir], legacy);
  assert.deepEqual(result.nextAction?.args.slice(1), ['bootstrap', '--help', '--json']);
  assert.equal(result.nextAction?.readOnly, true);
  const missing = createFirstRunContract(['--cwd', dir], { ...legacy, commands: {} });
  assert.equal(missing.nextAction, null);
});

test('programmatic import never advertises a test harness as an ATM executable', () => {
  const imported = resolveFirstRunRuntime(['next'], pathToFileURL(sourceRunner).href, fileURLToPath(import.meta.url), {});
  assert.equal(imported.status, 'unknown-entrypoint'); assert.equal(imported.runner, null);
  assert.equal(createFirstRunContract(['--cwd', root], imported).nextAction, null);
});

test('nearest runtime package owns version, not a same-named target ancestor', t => {
  const dir = fixture(t); put(dir, 'package.json', { name: 'ai-atomic-framework', version: '999.0.0' });
  const cli = path.join(dir, 'node_modules/@ai-atomic-framework/cli');
  put(cli, 'package.json', { name: '@ai-atomic-framework/cli', version: '0.2.3' });
  put(cli, 'dist/npm-runtime/data/atm-public.js', ''); put(cli, 'dist/npm-runtime/atm.mjs', '');
  const loaded = resolveFirstRunRuntime(['next'], pathToFileURL(path.join(cli, 'dist/npm-runtime/data/atm-public.js')).href, path.join(cli, 'dist/npm-runtime/atm.mjs'), {});
  assert.equal(loaded.version, '0.2.3'); assert.equal(loaded.status, 'available');
  put(cli, 'package.json', { name: '@ai-atomic-framework/cli', version: 'invalid' });
  assert.equal(resolveFirstRunRuntime(['next'], pathToFileURL(path.join(cli, 'dist/npm-runtime/data/atm-public.js')).href).status, 'inconsistent-runtime');
});

test('root help is zero-write, uses loaded registry, and stays within the control-plane budget', t => {
  const dir = fixture(t); put(dir, 'index.html', '<h1>Static</h1>'); const before = snapshot(dir);
  const started = performance.now();
  const child = spawnSync(process.execPath, [sourceRunner, '--help', '--cwd', dir, '--agents', 'none', '--prompt', 'Build a site', '--json'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr); assert.ok(performance.now() - started < 5000);
  const result = JSON.parse(child.stdout); assert.equal(result.evidence.firstRun.target.state, 'uninitialized');
  assert.equal(result.evidence.firstRun.runtime.commands['framework-mode'], undefined);
  assert.deepEqual(snapshot(dir), before);
});

test('legacy layout remains a diagnostic route and never implies current initialization', t => {
  const dir = fixture(t); initialized(dir);
  put(dir, '.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 1 });
  const result = first(dir); assert.equal(result.target.state, 'legacy-layout');
  assert.equal(result.nextAction?.args[1], 'doctor');
});

test('onefile provenance binds the persistent outer launcher; stale direct-run hints cannot redirect argv', t => {
  const dir = fixture(t), hash = 'a'.repeat(64), extracted = path.join(dir, hash), cli = path.join(extracted, 'packages/cli');
  const outer = path.join(dir, 'persistent atm.mjs');
  put(dir, 'persistent atm.mjs', '// installed launcher');
  put(cli, 'package.json', { name: '@ai-atomic-framework/cli', version: '1.2.3-rc.1+build.4' });
  put(cli, 'dist/atm.js', '');
  put(extracted, '.payload-ready.json', { schemaVersion: 'atm.onefilePayload.v0.1', payloadSha256: hash });
  const env = { ATM_ONEFILE_RUNTIME: '1', ATM_ONEFILE_LAUNCHER_PATH: outer, ATM_ONEFILE_PAYLOAD_SHA256: hash, ATM_ONEFILE_EXTRACTED_ROOT: extracted };
  const moduleUrl = pathToFileURL(path.join(cli, 'dist/atm.js')).href;
  const loaded = resolveFirstRunRuntime(['next'], moduleUrl, outer, env);
  assert.equal(loaded.status, 'available'); assert.equal(loaded.runner, outer); assert.equal(loaded.version, '1.2.3-rc.1+build.4');
  assert.equal(resolveFirstRunRuntime(['next'], moduleUrl, outer, { ...env, ATM_ONEFILE_PAYLOAD_SHA256: 'b'.repeat(64) }).runner, null);
  const direct = resolveFirstRunRuntime(['next'], pathToFileURL(sourceRunner).href, sourceRunner,
    { ...env, ATM_ONEFILE_EXTRACTED_ROOT: '/' });
  assert.equal(direct.runner, sourceRunner);
});

test('portable root-drop outer runner is executable but the distribution is not a project target', t => {
  const dir = fixture(t), cli = path.join(dir, 'packages/cli');
  put(dir, 'release-manifest.json', { schemaVersion: 'atm.rootDropRelease.v0.4', entrypoint: 'atm.mjs' });
  put(dir, 'atm.mjs', '// portable launcher');
  put(cli, 'package.json', { name: '@ai-atomic-framework/cli', version: '0.2.0' });
  put(cli, 'dist/atm.js', '');
  const loaded = resolveFirstRunRuntime(['next'], pathToFileURL(path.join(cli, 'dist/atm.js')).href, path.join(dir, 'atm.mjs'), {});
  assert.equal(loaded.status, 'available'); assert.equal(loaded.runner, path.join(dir, 'atm.mjs'));
  assert.equal(createFirstRunContract(['--cwd', dir], loaded).target.state, 'runtime-distribution');
  assert.equal(createFirstRunContract(['--cwd', dir], loaded).nextAction, null);
});

test('unclassified project work reaches an executable zero-write taskflow preview, not atom/package synthesis', async t => {
  const dir = fixture(t); await runBootstrap(['--cwd', dir]);
  const orientation = probeProject(dir);
  for (const goal of ['Build a small static website for my newsletter', 'Implement CSV sorting', '建立一個小型靜態網站']) {
    const decision = decideGuidanceRoute({ goal, orientation });
    assert.equal(decision.recommendedRoute, 'docs-first');
    assert.equal(decision.nextCommand, 'node atm.mjs taskflow open --dry-run --json');
    assert.ok(!decision.blockedBy.includes('package-json-missing'));
    assert.ok(decision.blockedBy.includes('git-repository-missing'), 'unrelated blockers remain enforced');
  }
  const before = snapshot(dir);
  const preview = await runTaskflow(['open', '--cwd', dir, '--dry-run']);
  assert.equal(preview.ok, true); assert.deepEqual(snapshot(dir), before);
});

test('explicit atom birth and prior evidence/classified route families remain distinct', async t => {
  const dir = fixture(t); await runBootstrap(['--cwd', dir]); const orientation = probeProject(dir);
  for (const [goal, route] of [
    ['create a new atom for a greenfield capability', 'create-atom'], ['open task cards from plan', 'task-plan-import'],
    ['update documentation', 'docs-first'], ['rank messy source candidates', 'legacy-candidate-ranking'],
    ['split the parser', 'split'], ['reuse existing atom', 'infect'], ['extract legacy helper', 'atomize'],
    ['upgrade module version', 'evolve']
  ]) assert.equal(decideGuidanceRoute({ goal, orientation }).recommendedRoute, route, goal);
});

test('non-file metadata and oversized metadata never route to a potentially unbounded doctor read', t => {
  for (const kind of ['directory', 'oversized']) {
    const dir = fixture(t); initialized(dir); rmSync(path.join(dir, '.atm/config.json'));
    if (kind === 'directory') mkdirSync(path.join(dir, '.atm/config.json'));
    else put(dir, '.atm/config.json', ' '.repeat(1024 * 1024 + 1));
    const before = snapshot(dir), result = first(dir);
    assert.equal(result.target.state, 'unsafe-target', kind); assert.equal(result.nextAction, null, kind);
    assert.deepEqual(snapshot(dir), before);
  }
});

test('FIFO metadata is refused without opening it or recommending a command that might block', { skip: process.platform === 'win32' }, t => {
  const dir = fixture(t); initialized(dir); const config = path.join(dir, '.atm/config.json'); rmSync(config);
  const made = spawnSync('mkfifo', [config], { encoding: 'utf8' }); assert.equal(made.status, 0, made.stderr);
  const started = performance.now(), result = first(dir);
  assert.equal(result.target.state, 'unsafe-target'); assert.equal(result.nextAction, null);
  assert.ok(performance.now() - started < 1000);
});

test('unreadable metadata is a path blocker, not permission to try another reader', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const dir = fixture(t); initialized(dir); const config = path.join(dir, '.atm/config.json');
  chmodSync(config, 0);
  try { const result = first(dir); assert.equal(result.target.state, 'unsafe-target'); assert.equal(result.nextAction, null); }
  finally { chmodSync(config, 0o600); }
});

test('a missing config cannot hide unsafe reserved parent directories', t => {
  for (const entry of ['.atm/runtime', '.atm/history', '.atm/catalog']) {
    const dir = fixture(t), other = fixture(t); mkdirSync(path.join(dir, '.atm')); symlinkSync(other, path.join(dir, entry));
    const result = first(dir, ['--agents', 'none']); assert.equal(result.target.state, 'unsafe-target', entry);
    assert.equal(result.nextAction, null, entry);
  }
});

test('unreadable reserved directories are checked without scanning their contents', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  for (const relative of ['.atm/history', '.atm/catalog']) {
    const dir = fixture(t); initialized(dir); const container = path.join(dir, relative); mkdirSync(container, { recursive: true });
    chmodSync(container, 0);
    try { const result = first(dir); assert.equal(result.target.state, 'unsafe-target', relative); assert.equal(result.nextAction, null); }
    finally { chmodSync(container, 0o700); }
  }
});

test('malformed first-run options do not select an executable or mutate either target', t => {
  const one = fixture(t), two = fixture(t); initialized(one); initialized(two);
  const before = [snapshot(one), snapshot(two)];
  for (const argv of [
    ['--cwd', one, '--cwd', two], ['--cwd', one, '--agents', 'codex,none'],
    ['--cwd', one, '--prompt'], ['--cwd', one, '--agents', 'model-name'],
    ['--cwd', one, '--agents', 'codex', '--agents', 'cursor']
  ]) { const result = createFirstRunContract(argv, runtime); assert.equal(result.nextAction, null); assert.ok(result.requires.length > 0); }
  assert.deepEqual([snapshot(one), snapshot(two)], before);
});

test('profile validation consumes the bounded snapshot without reopening the profile path', t => {
  const dir = fixture(t); initialized(dir); const profile = path.join(dir, 'taskflow.profile.json');
  const originalRead = fs.readFileSync; let reopened = 0;
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    if (typeof file === 'string' && path.resolve(file) === profile) { reopened += 1; throw new Error('A path-based profile re-read could observe a replaced file.'); }
    return (originalRead as (...args: unknown[]) => unknown)(file, ...args);
  }) as typeof fs.readFileSync;
  try { assert.equal(first(dir).target.state, 'ready'); assert.equal(reopened, 0); }
  finally { fs.readFileSync = originalRead; }
  put(dir, 'taskflow.profile.json', { schemaId: 'taskflow.profile.v1', id: 'invalid-profile' });
  assert.equal(first(dir).target.state, 'invalid-config', 'the shared schema validator must still reject invalid profiles');
});
