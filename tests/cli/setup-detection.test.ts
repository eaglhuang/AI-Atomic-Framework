import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectInstalledAgents, supportedAgentIds } from '../../packages/cli/src/commands/setup/detection.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-detection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const repositoryRoot = path.join(root, 'project');
  mkdirSync(homeDir); mkdirSync(repositoryRoot);
  const options = { homeDir, repositoryRoot, env: {} };
  const dir = (base: string, rel: string) => mkdirSync(path.join(base, rel), { recursive: true });
  const file = (base: string, rel: string) => { mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); writeFileSync(path.join(base, rel), 'unreadable contents are irrelevant'); };
  return { options, homeDir, repositoryRoot, dir, file, root };
}
for (const platform of ['linux', 'darwin', 'win32'] as const) {
  test(`six home signals, stable order and dedup (${platform} contract)`, t => {
    const f = fixture(t);
    for (const rel of ['.claude', '.codex', '.copilot', '.cursor', '.gemini/commands', '.gemini/antigravity', '.gemini/antigravity-ide', '.gemini/antigravity-cli']) f.dir(f.homeDir, rel);
    const options = { ...f.options, platform, env: { CODEX_HOME: path.join(f.homeDir, '.codex') } };
    const result = detectInstalledAgents(options);
    assert.deepEqual(result.adapters.map(x => x.id), supportedAgentIds);
    assert.equal(result.adapters.find(x => x.id === 'codex')!.evidence.length, 1);
    assert.equal(result.adapters.find(x => x.id === 'antigravity')!.evidence.length, 3);
    assert.deepEqual(result, detectInstalledAgents(options));
    assert.deepEqual(result.warnings, []);
  });
}
test('generic shared paths never infer vendors', t => {
  const f = fixture(t);
  for (const base of [f.homeDir, f.repositoryRoot]) {
    for (const rel of ['.github', '.gemini', '.agents/skills']) f.dir(base, rel);
    f.file(base, 'GEMINI.md');
  }
  assert.deepEqual(detectInstalledAgents(f.options).adapters, []);
});
test('Antigravity-only is distinct; adding Gemini signal yields both', t => {
  const f = fixture(t); f.dir(f.homeDir, '.gemini/antigravity');
  assert.deepEqual(detectInstalledAgents(f.options).adapters.map(x => x.id), ['antigravity']);
  f.file(f.homeDir, '.gemini/settings.json');
  assert.deepEqual(detectInstalledAgents(f.options).adapters.map(x => x.id), ['gemini', 'antigravity']);
});
test('documented overrides require existing absolute directories', t => {
  const f = fixture(t);
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'COPILOT_HOME']) {
    env[key] = path.join(f.root, key); mkdirSync(env[key]!);
  }
  assert.deepEqual(detectInstalledAgents({ ...f.options, env }).adapters.map(x => x.id), ['claude-code', 'codex', 'copilot']);
  assert.deepEqual(detectInstalledAgents({ ...f.options, env: { CODEX_HOME: path.join(f.root, 'missing') } }).adapters, []);
  const relative = detectInstalledAgents({ ...f.options, env: { CODEX_HOME: '../outside' } });
  assert.deepEqual(relative.adapters, []); assert.equal(relative.warnings.length, 1);
});
test('project entries are separately classified, no CLI claim', t => {
  const f = fixture(t); f.file(f.repositoryRoot, '.github/copilot-instructions.md');
  f.file(f.repositoryRoot, '.codex/config.toml');
  const result = detectInstalledAgents(f.options);
  assert.deepEqual(result.adapters.map(x => x.id), ['codex', 'copilot']);
  assert.ok(result.adapters.every(x => x.evidence.every(e => e.kind === 'project-entry')));
});
test('wrong filesystem types and missing parents are ignored', t => {
  const f = fixture(t); f.file(f.homeDir, '.codex'); f.dir(f.homeDir, '.gemini/settings.json');
  assert.deepEqual(detectInstalledAgents(f.options), { adapters: [], warnings: [] });
});
test('symlink evidence is skipped with a warning (including dangling link)', t => {
  const f = fixture(t);
  try { symlinkSync(path.join(f.root, 'missing'), path.join(f.homeDir, '.codex'), 'junction'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('host cannot create links'); return; } throw error; }
  const result = detectInstalledAgents(f.options);
  assert.deepEqual(result.adapters, []); assert.equal(result.warnings.length, 1);
});
test('invalid metadata path reports warning instead of throwing', t => {
  const f = fixture(t);
  const result = detectInstalledAgents({ ...f.options, env: { CODEX_HOME: path.join(f.root, 'bad\0name') } });
  assert.deepEqual(result.adapters, []); assert.equal(result.warnings.length, 1);
});

test('GEMINI_CLI_HOME is a parent home, with no generic-directory inference', t => {
  const f = fixture(t); const alternate = path.join(f.root, 'alternate');
  f.dir(alternate, '.gemini'); f.file(alternate, 'settings.json');
  const options = { ...f.options, env: { GEMINI_CLI_HOME: alternate } };
  assert.deepEqual(detectInstalledAgents(options).adapters, []);
  f.file(alternate, '.gemini/settings.json');
  assert.deepEqual(detectInstalledAgents(options).adapters, [{ id: 'gemini', evidence: [{ kind: 'home-config', path: path.join(alternate, '.gemini/settings.json') }] }]);
  assert.equal(detectInstalledAgents({ ...f.options, env: { GEMINI_CLI_HOME: '../relative' } }).warnings.length, 1);
});
test('ATM_EDITOR_ID exact explicit evidence works without config and adds all vendors', t => {
  const f = fixture(t);
  for (const id of supportedAgentIds) {
    assert.deepEqual(detectInstalledAgents({ ...f.options, env: { ATM_EDITOR_ID: id } }).adapters, [{ id, evidence: [{ kind: 'environment', name: 'ATM_EDITOR_ID' }] }]);
  }
  f.dir(f.homeDir, '.claude');
  const result = detectInstalledAgents({ ...f.options, env: { ATM_EDITOR_ID: 'codex' } });
  assert.deepEqual(result.adapters.map(x => x.id), ['claude-code', 'codex']);
});
test('actor identity, partial and unknown editor names do not infer vendors', t => {
  const f = fixture(t);
  for (const value of ['codex-gpt-5', 'not-copilot', 'gemini-antigravity', 'Codex', 'unknown']) {
    assert.deepEqual(detectInstalledAgents({ ...f.options, env: { ATM_EDITOR_ID: value, ATM_ACTOR_ID: 'codex', AGENT_IDENTITY: 'claude-code' } }).adapters, []);
  }
});
test('environment plus configuration evidence dedupe independently', t => {
  const f = fixture(t); f.dir(f.homeDir, '.codex');
  const result = detectInstalledAgents({ ...f.options, env: { ATM_EDITOR_ID: 'codex', CODEX_HOME: path.join(f.homeDir, '.codex') } });
  assert.equal(result.adapters.length, 1); assert.equal(result.adapters[0].evidence.length, 2);
  assert.equal(result.adapters[0].evidence[0].kind, 'environment');
});

