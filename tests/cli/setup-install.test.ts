import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { installPinnedRunner } from '../../packages/plugin-governance-local/src/bootstrap/bootstrap/bootstrap-support.ts';
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSetup } from '../../packages/cli/src/commands/setup.ts';
import { formatPrettyResult } from '../../packages/cli/src/commands/shared/command-spec-output.ts';
import { isSameOrWithin, validateSetupTarget } from '../../packages/cli/src/commands/setup/target.ts';
import { compareManifestParity } from '../../packages/cli/src/commands/integration/health.ts';
import { createIntegrationAdapter } from '../../packages/cli/src/commands/integration/adapters.ts';
import { runIntegration } from '../../packages/cli/src/commands/integration/run.ts';
import { setupRunnerPath } from '../../packages/cli/src/commands/setup/runner.ts';
import { ensureSetupProjectRunner, preflightSetupProjectRunner, sharedProjectLauncher } from '../../packages/cli/src/commands/setup/project-runner.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { InstallManifest } from '../../packages/integrations-core/src/index.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), homeDir = path.join(root, 'home');
  mkdirSync(project); mkdirSync(homeDir);
  return { root, project, homeDir, input: { interactive: false, detection: { homeDir, env: {} } } };
}

function snapshotTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(absolute)}`;
      else if (entry.isDirectory()) { result[relative] = 'directory'; walk(absolute); }
      else result[relative] = createHash('sha256').update(readFileSync(absolute)).digest('hex');
    }
  }
  walk(root); return result;
}

test('noninteractive and JSON modes never prompt or choose a non-project cwd', async t => {
  const f = fixture(t); let asked = false;
  await assert.rejects(runSetup(['--json'], { ...f.input, interactive: true, ask: async () => { asked = true; return f.project; } }), /Pass explicit/);
  assert.equal(asked, false);
  await assert.rejects(runSetup(['--cwd', f.project, '--json'], f.input), /No agent configuration/);
  assert.equal(existsSync(path.join(f.project, '.atm')), false);
});

test('interactive target and explicit CLI-only selection produce no-write plan', async t => {
  const f = fixture(t); const replies = [f.project, 'none'];
  const result = await runSetup(['--dry-run'], { ...f.input, interactive: true, ask: async () => replies.shift()! });
  assert.equal(result.ok, true); assert.equal(result.cwd, f.project);
  assert.equal(result.evidence.cliOnly, true);
  assert.equal(existsSync(path.join(f.project, '.atm')), false);
});

test('cancelled target and malformed agent selection do not write', async t => {
  const f = fixture(t);
  await assert.rejects(runSetup([], { ...f.input, interactive: true, ask: async () => '' }), /cancelled/);
  await assert.rejects(runSetup(['--cwd', f.project, '--agents', 'codex,unknown'], f.input), /supported adapter/);
  assert.equal(existsSync(path.join(f.project, '.atm')), false);
});

test('pretty setup output is a step summary and keeps the full evidence in --json', async t => {
  const f = fixture(t);
  const result = await runSetup(['--cwd', f.project, '--agents', 'none', '--dry-run'], f.input);
  const pretty = formatPrettyResult(result);
  assert.match(pretty, /^\[OK\] setup/);
  assert.match(pretty, /ok\s+preflight/);
  assert.match(pretty, /Run with --json for the full evidence\./);
  assert.doesNotMatch(pretty, /"detection"|evidence:/);
  assert.ok(pretty.split('\n').length < 15);
});

test('unsafe home, filesystem root and symlink targets are rejected', t => {
  const f = fixture(t);
  assert.throws(() => validateSetupTarget(f.homeDir, f.homeDir, {}), /project directory/);
  assert.throws(() => validateSetupTarget(path.parse(f.root).root, f.homeDir, {}), /project directory/);
  assert.throws(() => validateSetupTarget(path.join(f.homeDir, '.claude/skills/new'), f.homeDir, {}), /project directory/);
  assert.equal(isSameOrWithin('C:\\Users\\Alice\\.CLAUDE\\skills', 'c:\\users\\alice\\.claude', true, 'win32'), true);
  assert.equal(isSameOrWithin('C:\\Users\\Alice\\projects', 'C:\\Users\\Alice\\.claude', true, 'win32'), false);
  symlinkSync(f.homeDir, path.join(f.project, '.atm'), 'dir');
  assert.throws(() => validateSetupTarget(f.project, f.homeDir, {}), /UNSAFE_PATH/);
});

test('native Codex drift is detected and removal preserves the surviving adapter', async t => {
  const f = fixture(t);
  assert.equal((await runSetup(['--cwd', f.project, '--agents', 'codex,antigravity', '--json'], f.input)).ok, true);
  assert.equal((await runIntegration(['remove', 'antigravity', '--cwd', f.project])).ok, true);
  const native = path.join(f.project, '.agents/skills/atm-governance-router/SKILL.md');
  assert.ok(existsSync(native));
  assert.equal((await runIntegration(['verify', 'codex', '--cwd', f.project])).ok, true);
  const original = readFileSync(native); writeFileSync(native, 'edited native router');
  assert.equal((await runIntegration(['verify', 'codex', '--cwd', f.project])).ok, false);
  writeFileSync(native, original);
  assert.equal((await runIntegration(['remove', 'codex', '--cwd', f.project])).ok, true);
  assert.equal(existsSync(native), false);
  assert.equal(existsSync(path.join(f.project, '.atm/integrations/codex.host.json')), false);
});

test('removing Codex first preserves Antigravity native entry', async t => {
  const f = fixture(t);
  assert.equal((await runSetup(['--cwd', f.project, '--agents', 'codex,antigravity', '--json'], f.input)).ok, true);
  await runIntegration(['remove', 'codex', '--cwd', f.project]);
  assert.ok(existsSync(path.join(f.project, '.agents/skills/atm-governance-router/SKILL.md')));
  assert.equal((await runIntegration(['verify', 'antigravity', '--cwd', f.project])).ok, true);
});

test('missing native manifest is unhealthy and corrupt manifest cannot orphan primary files', async t => {
  const f = fixture(t);
  assert.equal((await runSetup(['--cwd', f.project, '--agents', 'codex', '--json'], f.input)).ok, true);
  const host = path.join(f.project, '.atm/integrations/codex.host.json');
  const originalHost = JSON.parse(readFileSync(host, 'utf8')) as InstallManifest;
  const primary = path.join(f.project, '.atm/integrations/codex.manifest.json');
  const previous = readFileSync(primary);
  rmSync(host);
  assert.equal((await runIntegration(['verify', 'codex', '--cwd', f.project])).ok, false);
  writeFileSync(host, '{broken');
  await assert.rejects(runIntegration(['remove', 'codex', '--cwd', f.project]));
  assert.deepEqual(readFileSync(primary), previous);
  assert.ok(existsSync(path.join(f.project, 'integrations/codex-skills/atm-governance-router/SKILL.md')));
  writeFileSync(host, JSON.stringify({ ...originalHost, metadata: { managedBlocks: '{' } }));
  await assert.rejects(runIntegration(['remove', 'codex', '--cwd', f.project]));
  assert.deepEqual(readFileSync(primary), previous);
});

test('edited bootstrap root blocks and directory collisions fail before writes', async t => {
  const f = fixture(t); const file = path.join(f.project, 'AGENTS.md');
  const original = '<!-- ATM ROOT ENTRY:START -->\nUser edited block\n<!-- ATM ROOT ENTRY:END -->';
  writeFileSync(file, original);
  const result = await runSetup(['--cwd', f.project, '--agents', 'none', '--json'], f.input);
  assert.equal(result.ok, false); assert.match(String(result.evidence.failure), /edited or malformed/);
  assert.equal(readFileSync(file, 'utf8'), original); assert.equal(existsSync(path.join(f.project, '.atm')), false);
  rmSync(file); mkdirSync(file);
  const collision = await runSetup(['--cwd', f.project, '--agents', 'none', '--json'], f.input);
  assert.equal(collision.ok, false); assert.equal(existsSync(path.join(f.project, '.atm')), false);
});

test('Claude substring and restricted matcher cannot fake required hook readiness', async t => {
  const f = fixture(t); mkdirSync(path.join(f.project, '.claude'));
  const file = path.join(f.project, '.claude/settings.json');
  const original = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo node atm.mjs integration hook pre-tool --editor claude-code --json' }] }] } });
  writeFileSync(file, original);
  const result = await runSetup(['--cwd', f.project, '--agents', 'claude-code', '--json'], f.input);
  assert.equal(result.ok, false); assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(existsSync(path.join(f.project, '.atm')), false);
});

test('one setup installs all six adapters and native bridges, preserving custom instructions', async t => {
  const f = fixture(t);
  const original = '# User Gemini instructions\nNever remove this.';
  writeFileSync(path.join(f.project, 'GEMINI.md'), original);
  writeFileSync(path.join(f.project, 'AGENTS.md'), '# Existing project rules\nKeep the build command.\n');
  writeFileSync(path.join(f.project, 'README.md'), '# Existing project\nKeep the description.\n');
  mkdirSync(path.join(f.project, '.claude'));
  writeFileSync(path.join(f.project, '.claude/settings.json'), JSON.stringify({ custom: true, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } }));
  const ids = ['claude-code', 'codex', 'copilot', 'cursor', 'gemini', 'antigravity'];
  const args = ['--cwd', f.project, '--agents', ids.join(','), '--json'];
  const result = await runSetup(args, f.input);
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const id of ids) assert.ok(existsSync(path.join(f.project, `.atm/integrations/${id}.manifest.json`)));
  assert.ok(existsSync(path.join(f.project, '.agents/skills/atm-governance-router/SKILL.md')));
  assert.ok(existsSync(path.join(f.project, '.cursor/rules/atm-governance.mdc')));
  assert.ok(readFileSync(path.join(f.project, 'GEMINI.md'), 'utf8').startsWith(original));
  assert.ok(readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8').includes('Keep the build command.'));
  assert.ok(readFileSync(path.join(f.project, 'README.md'), 'utf8').includes('Keep the description.'));
  assert.equal(JSON.parse(readFileSync(path.join(f.project, '.claude/settings.json'), 'utf8')).custom, true);
  assert.ok(readFileSync(path.join(f.project, '.claude/settings.json'), 'utf8').includes('echo user'));
  assert.ok(existsSync(path.join(f.project, '.github/hooks/atm-framework-development.json')));
  const before = readFileSync(path.join(f.project, 'GEMINI.md'));
  const again = await runSetup(args, f.input);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.deepEqual(readFileSync(path.join(f.project, 'GEMINI.md')), before);
  const installed = JSON.parse(readFileSync(path.join(f.project, '.atm/integrations/antigravity.manifest.json'), 'utf8')) as InstallManifest;
  const expected = await createIntegrationAdapter('antigravity').install({ repositoryRoot: f.project, dryRun: true });
  assert.equal(compareManifestParity(installed, expected.manifest).ok, true);
  assert.equal(existsSync(path.join(f.homeDir, '.atm')), false);
});

test('conflict preflight preserves all target files and does not bootstrap', async t => {
  const f = fixture(t); const skill = path.join(f.project, '.claude/skills/atm-governance-router');
  mkdirSync(skill, { recursive: true }); writeFileSync(path.join(skill, 'SKILL.md'), 'user skill');
  const result = await runSetup(['--cwd', f.project, '--agents', 'claude-code,codex', '--json'], f.input);
  assert.equal(result.ok, false); assert.match(String(result.evidence.failure), /MERGE_CONFLICT/);
  assert.equal(existsSync(path.join(f.project, '.atm')), false);
  assert.equal(readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), 'user skill');
});

test('shared execution against two projects keeps governance state separate', async t => {
  const f = fixture(t); const other = path.join(f.root, 'project-b'); mkdirSync(other);
  const first = await runSetup(['--cwd', f.project, '--agents', 'none', '--json'], f.input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(existsSync(path.join(f.project, '.atm/integrations/codex.manifest.json')), false, 'explicit none must not install current editor');
  const state = readFileSync(path.join(f.project, '.atm/config.json'));
  const task = readFileSync(path.join(f.project, '.atm/history/tasks/BOOTSTRAP-0001.json'));
  const second = await runSetup(['--cwd', other, '--agents', 'none', '--json'], f.input);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(readFileSync(path.join(f.project, '.atm/config.json')), state);
  assert.deepEqual(readFileSync(path.join(f.project, '.atm/history/tasks/BOOTSTRAP-0001.json')), task);
  assert.ok(existsSync(path.join(other, '.atm/history/tasks/BOOTSTRAP-0001.json')));
});

test('malformed user hook settings fail before bootstrap', async t => {
  const f = fixture(t); mkdirSync(path.join(f.project, '.claude'));
  const file = path.join(f.project, '.claude/settings.json'); writeFileSync(file, '{ invalid');
  const result = await runSetup(['--cwd', f.project, '--agents', 'claude-code', '--json'], f.input);
  assert.equal(result.ok, false); assert.equal(readFileSync(file, 'utf8'), '{ invalid');
  assert.equal(existsSync(path.join(f.project, '.atm/config.json')), false);
});

test('explicit other-agent selection ignores actual current-editor environment', async t => {
  const f = fixture(t);
  const result = await runSetup(['--cwd', f.project, '--agents', 'gemini', '--json'], f.input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(path.join(f.project, '.atm/integrations/codex.manifest.json')), false);
});

test('CLI called from unrelated directory returns executable absolute recovery argv', t => {
  const f = fixture(t); const conflict = path.join(f.project, '.claude/skills/atm-governance-router');
  mkdirSync(conflict, { recursive: true }); writeFileSync(path.join(conflict, 'SKILL.md'), 'user-owned');
  const runner = fileURLToPath(new URL('../../atm.dev.mjs', import.meta.url));
  const env = { ...process.env, ATM_ONEFILE_LAUNCHER_PATH: path.join(f.root, 'unrelated.mjs'), ATM_ONEFILE_EXTRACTED_ROOT: path.join(f.root, 'unrelated-cache') };
  assert.equal(setupRunnerPath(runner, env), runner);
  assert.equal(setupRunnerPath(path.join(env.ATM_ONEFILE_EXTRACTED_ROOT, 'runtime.js'), env), env.ATM_ONEFILE_LAUNCHER_PATH);
  const result = spawnSync(process.execPath, [runner, 'setup', '--cwd', f.project, '--agents', 'claude-code', '--json'], { cwd: f.homeDir, env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout || result.stderr);
  assert.equal(payload.evidence.recovery.args[0], runner);
  assert.equal(payload.evidence.recovery.args[payload.evidence.recovery.args.indexOf('--cwd') + 1], f.project);
  assert.equal(payload.evidence.nextCommand, null);
});

test('process CLI missing target and dry-run never write the launch directory or home', t => {
  const f = fixture(t); const launch = path.join(f.root, 'launch'); mkdirSync(launch);
  const runner = fileURLToPath(new URL('../../atm.dev.mjs', import.meta.url));
  const env = { ...process.env, HOME: f.homeDir, USERPROFILE: f.homeDir, CODEX_HOME: path.join(f.homeDir, '.codex') };
  for (const args of [
    ['--json'],
    ['--cwd', f.project, '--agents', 'none', '--dry-run', '--json'],
    ['--cwd', f.project, '--agents', 'none', '--dry-run=true', '--json']
  ]) {
    const result = spawnSync(process.execPath, [runner, 'setup', ...args], { cwd: launch, env, encoding: 'utf8', timeout: 30000 });
    if (args.includes('--dry-run')) assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(launch), []);
    assert.deepEqual(readdirSync(f.homeDir), []);
    assert.deepEqual(readdirSync(f.project), []);
  }
});

for (const layoutRoot of ['data', 'layout']) test(`npm ${layoutRoot} fallback launcher records metadata through bootstrap and is safe to rerun`, t => {
  const f = fixture(t); const packageRoot = path.join(f.root, 'official-package');
  const runtimeRoot = path.join(packageRoot, 'dist/npm-runtime'); mkdirSync(runtimeRoot, { recursive: true });
  const runtime = path.join(runtimeRoot, 'atm.mjs');
  const moduleUrl = pathToFileURL(path.join(runtimeRoot, layoutRoot, 'commands/setup/project-runner.js')).href;
  writeFileSync(runtime, `import { writeFileSync } from 'node:fs';\nif (process.argv[2] !== 'bootstrap' || !process.env.ATM_PINNED_RUNNER_SOURCE) process.exit(2);\nwriteFileSync(${JSON.stringify(path.join(f.project, 'bootstrap-called.json'))}, JSON.stringify({cwd:process.cwd(),source:process.env.ATM_PINNED_RUNNER_SOURCE}));\nprocess.stdout.write(JSON.stringify({ok:true}));\n`);
  writeFileSync(path.join(runtimeRoot, 'runtime.mjs'), '// fixture bundled runtime');
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', bin: { atm: 'dist/npm-runtime/atm.mjs' } }));
  writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({ schemaId: 'atm.cliNpmRuntimeManifest.v1', moduleIdentity: 'original-dist-relative-url', ...(layoutRoot === 'data' ? { layoutRoot } : {}), entrypoints: { bin: 'atm.mjs', runtime: 'runtime.mjs' }, files: ['atm.mjs', 'runtime.mjs'].map(name => ({path:name,sha256:`sha256:${createHash('sha256').update(readFileSync(path.join(runtimeRoot,name))).digest('hex')}`})) }));
  const plan = preflightSetupProjectRunner(f.project, moduleUrl, null);
  assert.equal(plan.runtime, runtime);
  assert.deepEqual(readdirSync(f.project), [], 'npm preflight must not write or bootstrap');
  // A competing file arrives immediately after the planner observes absence.
  const target = path.join(f.project, 'atm.mjs'); const exists = fs.existsSync; let checks = 0;
  t.mock.method(fs, 'existsSync', (file: Parameters<typeof exists>[0]) => {
    const present = exists(file);
    if (String(file) === target && ++checks === 2 && !present) writeFileSync(target, 'concurrent foreign launcher');
    return present;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', moduleUrl), /RUNNER_CONFLICT/);
    assert.equal(readFileSync(target, 'utf8'), 'concurrent foreign launcher');
    assert.equal(exists(path.join(f.project, 'bootstrap-called.json')), false, 'rejected runner must not be bootstrapped');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(target); }
  const first = ensureSetupProjectRunner(f.project, 'source-unavailable', moduleUrl);
  assert.equal(first.mode, 'shared-npm-runtime');
  const file = path.join(f.project, 'atm.mjs'); const bytes = readFileSync(file);
  assert.equal(bytes.toString('utf8'), sharedProjectLauncher(runtime));
  ensureSetupProjectRunner(f.project, 'source-unavailable', moduleUrl);
  assert.deepEqual(readFileSync(file), bytes);
  const receipt = JSON.parse(readFileSync(path.join(f.project, 'bootstrap-called.json'), 'utf8'));
  assert.equal(receipt.cwd, f.project); assert.equal(receipt.source, file);
  const newPackage = path.join(f.root, 'new-installation'); cpSync(packageRoot, newPackage, { recursive: true });
  const newModuleUrl = pathToFileURL(path.join(newPackage, 'dist/npm-runtime', layoutRoot, 'commands/setup/project-runner.js')).href;
  assert.throws(() => preflightSetupProjectRunner(f.project, newModuleUrl, null), /RUNNER_CONFLICT/);
  assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', newModuleUrl), /RUNNER_CONFLICT/);
  assert.deepEqual(readFileSync(file), bytes);
  rmSync(runtime);
  assert.throws(() => preflightSetupProjectRunner(f.project, newModuleUrl, null), /RUNNER_CONFLICT/);
  assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', newModuleUrl), /RUNNER_CONFLICT/);
  const child = spawnSync(process.execPath, [file, 'next', '--json'], { cwd: f.project, encoding: 'utf8' });
  assert.equal(child.status, 1); assert.match(child.stderr, /ATM_SHARED_RUNTIME_MISSING/);
  assert.match(child.stderr, /retained backup/);
  const backup = `${file}.backup`; renameSync(file, backup);
  ensureSetupProjectRunner(f.project, 'source-unavailable', newModuleUrl);
  assert.deepEqual(readFileSync(backup), bytes);
  assert.equal(readFileSync(file, 'utf8'), sharedProjectLauncher(path.join(newPackage, 'dist/npm-runtime/atm.mjs')));
  writeFileSync(file, readFileSync(file, 'utf8') + '// user edit\n');
  const edited = readFileSync(file);
  assert.throws(() => preflightSetupProjectRunner(f.project, newModuleUrl, null), /RUNNER_CONFLICT/);
  assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', newModuleUrl), /RUNNER_CONFLICT/);
  assert.deepEqual(readFileSync(file), edited);
});

for (const layoutRoot of ['data', 'layout']) test(`npm ${layoutRoot} launcher rejects inconsistent identity and integrity before writing`, t => {
  const f = fixture(t); const packageRoot = path.join(f.root, 'package');
  const runtimeRoot = path.join(packageRoot, 'dist/npm-runtime'); mkdirSync(runtimeRoot, { recursive: true });
  const moduleUrl = pathToFileURL(path.join(runtimeRoot, layoutRoot, 'commands/setup/project-runner.js')).href;
  const pkg = { name: '@ai-atomic-framework/cli', bin: { atm: 'dist/npm-runtime/atm.mjs' } };
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify(pkg));
  const files = ['atm.mjs', 'runtime.mjs'].map(name => {
    writeFileSync(path.join(runtimeRoot, name), '// fixture');
    return { path: name, sha256: `sha256:${createHash('sha256').update('// fixture').digest('hex')}` };
  });
  const manifest = { schemaId: 'atm.cliNpmRuntimeManifest.v1', moduleIdentity: 'original-dist-relative-url', layoutRoot,
    entrypoints: { bin: 'atm.mjs', runtime: 'runtime.mjs' }, files };
  for (const change of [
    { moduleIdentity: 'unsupported' }, { layoutRoot: '../data' },
    { layoutRoot: layoutRoot === 'data' ? 'layout' : 'data' },
    { entrypoints: { bin: 'other.mjs', runtime: 'runtime.mjs' } },
    { entrypoints: { bin: 'atm.mjs', runtime: 'other.mjs' } },
    { files: [...files, files[0]] }
  ]) {
    writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({ ...manifest, ...change }));
    assert.throws(() => preflightSetupProjectRunner(f.project, moduleUrl, null), /RUNTIME_IDENTITY_INVALID/);
    assert.deepEqual(readdirSync(f.project), []);
    assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', moduleUrl), /RUNTIME_IDENTITY_INVALID/);
    assert.equal(existsSync(path.join(f.project, 'atm.mjs')), false);
  }
  writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['atm.mjs', 'runtime.mjs']) {
    writeFileSync(path.join(runtimeRoot, name), '// tampered');
    assert.throws(() => preflightSetupProjectRunner(f.project, moduleUrl, null), /RUNTIME_IDENTITY_INVALID/);
    assert.deepEqual(readdirSync(f.project), []);
    assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable', moduleUrl), /RUNTIME_IDENTITY_INVALID/);
    writeFileSync(path.join(runtimeRoot, name), '// fixture');
  }
  assert.equal(existsSync(path.join(f.project, 'atm.mjs')), false);
});

for (const dryRun of [false, true]) test(`a different existing project runner rejects before any writes (dryRun=${dryRun})`, async t => {
  const f = fixture(t); const file = path.join(f.project, 'atm.mjs'); const original = '// user-owned unrelated runner\n';
  writeFileSync(file, original);
  writeFileSync(path.join(f.project, 'README.md'), '# Existing project\n');
  mkdirSync(path.join(f.project, 'assets'));
  writeFileSync(path.join(f.project, 'assets/retained.bin'), Buffer.from([0, 255, 128, 7]));
  const before = snapshotTree(f.project);
  const result = await runSetup(['--cwd', f.project, '--agents', 'none', ...(dryRun ? ['--dry-run'] : []), '--json'], f.input);
  assert.equal(result.ok, false); assert.match(String(result.evidence.failure), /RUNNER_CONFLICT/);
  assert.deepEqual(snapshotTree(f.project), before, 'rejected setup must preserve every path and file digest');
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(result.evidence.nextCommand, null);
});

test('source fallback refuses arbitrary invocation identity before writing a launcher', t => {
  const f = fixture(t);
  assert.throws(() => ensureSetupProjectRunner(f.project, 'source-unavailable'), /RUNNER_MISSING/);
  assert.equal(existsSync(path.join(f.project, 'atm.mjs')), false);
});

for (const kind of ['directory', 'symlink', 'non-UTF-8']) test(`launcher ${kind} is rejected without changing the project`, async t => {
  const f = fixture(t); const file = path.join(f.project, 'atm.mjs');
  if (kind === 'directory') mkdirSync(file);
  if (kind === 'symlink') { writeFileSync(path.join(f.root, 'foreign.mjs'), 'foreign'); symlinkSync(path.join(f.root, 'foreign.mjs'), file); }
  if (kind === 'non-UTF-8') writeFileSync(file, Buffer.from([0xff, 0xfe, 0x61]));
  const before = readdirSync(f.project);
  for (const dryRun of [false, true]) {
    const result = await runSetup(['--cwd', f.project, '--agents', 'none', ...(dryRun ? ['--dry-run'] : []), '--json'], f.input).catch(error => ({ ok: false, evidence: { failure: String(error) } }));
    assert.equal(result.ok, false); assert.deepEqual(readdirSync(f.project), before);
  }
  if (kind === 'non-UTF-8') assert.deepEqual(readFileSync(file), Buffer.from([0xff, 0xfe, 0x61]));
  if (kind === 'symlink') assert.equal(readFileSync(path.join(f.root, 'foreign.mjs'), 'utf8'), 'foreign');
});

test('pinned runner exclusive creation preserves a file arriving at the write boundary', t => {
  const f = fixture(t); const file = path.join(f.project, 'atm.mjs');
  mkdirSync(path.join(f.project, '.atm/runtime'), { recursive: true });
  const copy = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (source: Parameters<typeof copy>[0], target: Parameters<typeof copy>[1], flags?: number) => { writeFileSync(file, 'concurrent foreign launcher'); return copy(source, target, flags); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => installPinnedRunner(f.project, false, [], []), /RUNNER_CONFLICT/);
    assert.equal(readFileSync(file, 'utf8'), 'concurrent foreign launcher');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('noninteractive setup defaults to the current directory only when it is a project root', async t => {
  const f = fixture(t); const previous = process.cwd();
  try {
    process.chdir(f.project);
    await assert.rejects(runSetup(['--agents', 'none', '--dry-run', '--json'], f.input), /Pass explicit/);
    writeFileSync(path.join(f.project, 'package.json'), '{"name":"demo"}\n', 'utf8');
    const result = await runSetup(['--agents', 'none', '--dry-run', '--json'], f.input);
    assert.equal(result.ok, true);
    assert.equal(realpathSync(result.cwd), realpathSync(f.project));
  } finally { process.chdir(previous); }
});
