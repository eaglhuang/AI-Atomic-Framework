import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { resolveFrameworkTempPublicationCapability } from '../../packages/cli/src/commands/framework-development/framework-temp-publication-capability.ts';
import { frameworkDeclarationPolicyForSeal } from '../../packages/cli/src/commands/git-governance/implementation/commit-attempt-boundary.ts';
import { resolveGovernedCommitSeal, runWithSealedTaskScopedCommitIndex } from '../../packages/cli/src/commands/git-governance/implementation/sealed-commit-attribution.ts';

const entry = fileURLToPath(new URL('../../packages/cli/src/atm.ts', import.meta.url));
const actor = 'exact-declaration-fixture';
const target = 'dist/new.js';
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('ATM_') || key.startsWith('GIT_')) delete env[key];
env.GIT_CONFIG_NOSYSTEM = '1';
env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : os.devNull;

function put(root: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}
function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
}
function cli(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--strip-types', entry, ...args, '--cwd', root, '--json'],
    { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
  assert.ok(result.stdout, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
function fixture(declaration: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-exact-declaration-'));
  put(root, 'package.json', JSON.stringify({ name: 'ai-atomic-framework', workspaces: ['packages/*'] }));
  put(root, 'packages/core/src/index.ts', 'export {};\n');
  put(root, 'packages/cli/src/atm.ts', 'export {};\n');
  put(root, 'atomic-registry.json', '{}\n');
  put(root, '.gitignore', 'dist/\n.atm/runtime/\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Exact Fixture');
  git(root, 'config', 'user.email', 'exact@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture baseline');
  const registration = cli(root, 'actor', 'register', '--id', actor, '--kind', 'ai-agent', '--name', 'Exact Fixture',
    '--git-name', 'Exact Fixture', '--git-email', 'exact@example.invalid');
  assert.equal(registration.ok, true, JSON.stringify(registration));
  const identity = cli(root, 'identity', 'set', '--actor', actor, '--editor', 'codex',
    '--git-name', 'Exact Fixture', '--git-email', 'exact@example.invalid');
  assert.equal(identity.ok, true, JSON.stringify(identity));
  put(root, target, 'export const admitted = true;\n');
  const claim = cli(root, 'framework-mode', 'claim', '--actor', actor,
    '--files', `${declaration},.atm/catalog/registry/actors.json`, '--reason', 'Exact ignored-file commit regression');
  assert.equal(claim.ok, true, JSON.stringify(claim));
  return root;
}

test('real taskless facade preserves an exact ignored-file declaration through preview and sealed commit', () => {
  const root = fixture(target);
  try {
    const before = git(root, 'rev-parse', 'HEAD');
    const bytes = readFileSync(path.join(root, target));
    const preview = cli(root, 'git', 'commit', '--actor', actor, '--message', 'fixture exact file', '--auto-stage', '--dry-run');
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(git(root, 'diff', '--cached', '--name-only'), '');
    const result = cli(root, 'git', 'commit', '--actor', actor, '--message', 'fixture exact file', '--auto-stage');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.notEqual(git(root, 'rev-parse', 'HEAD'), before);
    assert.equal(git(root, 'show', `HEAD:${target}`), bytes.toString().trim());
    assert.match(git(root, 'log', '-1', '--format=%B'), new RegExp(`ATM-Actor: ${actor}`));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const declaration of ['dist', 'dist/**']) test(`real facade cannot promote ${declaration} or staged bytes to an exact ignored declaration`, () => {
  const root = fixture(declaration);
  try {
    // Inject a foreign candidate only into this disposable test index.
    git(root, 'add', '-f', '--', target);
    const before = git(root, 'rev-parse', 'HEAD');
    const index = git(root, 'ls-files', '--stage');
    const result = cli(root, 'git', 'commit', '--actor', actor, '--message', 'must refuse undeclared ignored', '--auto-stage');
    assert.equal(result.ok, false);
    assert.equal(result.messages[0].data.nestedFailure.errorCode, 'ATM_COMMIT_UNDECLARED_IGNORED_PATH');
    assert.equal(git(root, 'rev-parse', 'HEAD'), before);
    assert.equal(git(root, 'ls-files', '--stage'), index, 'refusal restores the original staged index');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function canonical(root: string, laneSessionId: string | null = null) {
  const selected = resolveFrameworkTempPublicationCapability({ cwd: root, taskId: null, actorId: actor, laneSessionId });
  assert.ok(selected);
  return selected;
}

test('canonical declarations exclude receipt inventory and directory/wildcard grants', () => {
  const root = fixture('dist,dist/**');
  try {
    const initial = canonical(root);
    put(root, `.atm/history/evidence/${initial.taskId}.runner-sync-receipt.json`, JSON.stringify({
      schemaId: 'atm.runnerSyncReceipt.v1', taskId: initial.taskId, actorId: actor,
      outputInventory: { entries: [{ path: 'automatic.js', disposition: 'owned-current' }] },
    }));
    const selected = canonical(root);
    assert.ok(selected.allowedFiles.includes('automatic.js'));
    assert.deepEqual(selected.declaredFiles, ['.atm/catalog/registry/actors.json']);
    const policy = frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor, laneSessionId: null,
      selected, paths: [target, 'automatic.js'] });
    assert.deepEqual(policy.declaredPaths, selected.declaredFiles);
    assert.ok(!policy.declaredPaths.includes('automatic.js'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('selection-to-seal authority changes fail closed without touching index or extending the lock', () => {
  const root = fixture(target);
  try {
    const lockRoot = path.join(root, '.atm/runtime/locks');
    const lockPath = path.join(lockRoot, readdirSync(lockRoot).find(file => file.endsWith('.lock.json'))!);
    const original = JSON.parse(readFileSync(lockPath, 'utf8'));
    const selected = canonical(root);
    const index = git(root, 'ls-files', '--stage');
    const changes = [
      { status: 'released' }, { heartbeatAt: '2000-01-01T00:00:00.000Z' },
      { actorId: 'foreign-actor' }, { laneSessionId: 'foreign-lane' },
      { files: ['elsewhere.js'] }, { leaseId: 'replacement-generation' },
    ];
    for (const change of changes) {
      const changed = JSON.stringify({ ...original, ...change });
      writeFileSync(lockPath, changed);
      assert.throws(() => frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor,
        laneSessionId: null, selected, paths: [target] }), { code: 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED' });
      assert.equal(readFileSync(lockPath, 'utf8'), changed, 'reject before renewing authority');
      assert.equal(git(root, 'ls-files', '--stage'), index);
    }
    writeFileSync(lockPath, JSON.stringify(original));
    assert.throws(() => frameworkDeclarationPolicyForSeal({ cwd: root, actorId: 'foreign-actor',
      laneSessionId: null, selected, paths: [target] }), { code: 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED' });
    assert.throws(() => frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor,
      laneSessionId: null, selected, paths: ['out-of-scope.js'] }), { code: 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED' });
    assert.throws(() => frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor,
      laneSessionId: null, selected: { ...selected, declaredFiles: [...selected.declaredFiles, 'automatic.js'] },
      paths: [target] }), { code: 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED' });
    put(root, '.atm/runtime/locks/duplicate.lock.json', JSON.stringify(original));
    assert.throws(() => frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor,
      laneSessionId: null, selected, paths: [target] }), { code: 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fallback preserves read-only boundary and ordinary admitted seals; worktree mutation cannot replace sealed bytes', () => {
  const root = fixture(target);
  try {
    git(root, 'add', '-f', '--', target);
    const selected = canonical(root);
    const policy = frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor, laneSessionId: null,
      selected, paths: [target] });
    const before = git(root, 'ls-files', '--stage');
    assert.throws(() => resolveGovernedCommitSeal({ cwd: root, paths: [target], provenance: 'pre-staged-index',
      policy: { ...policy, readOnlyPaths: ['dist/**'] } }), { code: 'ATM_COMMIT_CANDIDATE_SCOPE_VIOLATION' });
    assert.equal(git(root, 'ls-files', '--stage'), before);
    const tracked = 'packages/core/src/index.ts';
    for (const boundary of [{ readOnlyPaths: ['packages/core/**'] }, { scopePaths: ['dist/**'] }]) {
      assert.throws(() => resolveGovernedCommitSeal({ cwd: root, paths: [tracked], provenance: 'pre-staged-index',
        policy: { declaredPaths: [tracked], ...boundary } }), { code: 'ATM_COMMIT_CANDIDATE_SCOPE_VIOLATION' });
    }
    const source = resolveGovernedCommitSeal({ cwd: root, paths: [target], provenance: 'pre-staged-index', policy });
    assert.equal(source.kind, 'sealed-bundle');
    if (source.kind !== 'sealed-bundle') assert.fail('expected admitted seal');
    const preserved = resolveGovernedCommitSeal({ cwd: root, paths: ['unrelated.js'], provenance: 'task-scope',
      admittedBundle: source.bundle, policy: { declaredPaths: [], readOnlyPaths: ['**'] } });
    if (preserved.kind !== 'sealed-bundle') assert.fail('expected preserved admitted seal');
    assert.equal(preserved.bundle, source.bundle, 'ordinary admitted bundle does not enter fallback policy');
    put(root, target, 'foreign bytes after seal\n');
    runWithSealedTaskScopedCommitIndex({ cwd: root, paths: [target], provenance: 'pre-staged-index',
      surface: 'sealed bytes regression', sealSource: source, run: candidateEnv => {
        const actual = execFileSync('git', ['show', `:${target}`], { cwd: root, env: { ...env, ...candidateEnv }, encoding: 'utf8' });
        assert.equal(actual, 'export const admitted = true;\n');
        execFileSync('git', ['commit', '-qm', 'fixture commits frozen bytes'], { cwd: root, env: { ...env, ...candidateEnv } });
      } });
    assert.equal(readFileSync(path.join(root, target), 'utf8'), 'foreign bytes after seal\n');
    assert.equal(git(root, 'ls-files', '--stage'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('post-seal candidate-index replacement cannot return successful attribution', () => {
  const root = fixture(target);
  try {
    git(root, 'add', '-f', '--', target);
    const policy = frameworkDeclarationPolicyForSeal({ cwd: root, actorId: actor, laneSessionId: null,
      selected: canonical(root), paths: [target] });
    const source = resolveGovernedCommitSeal({ cwd: root, paths: [target], provenance: 'pre-staged-index', policy });
    assert.throws(() => runWithSealedTaskScopedCommitIndex({ cwd: root, paths: [target],
      provenance: 'pre-staged-index', surface: 'post-seal index tamper regression', sealSource: source,
      run: candidateEnv => {
        put(root, target, 'foreign index bytes\n');
        execFileSync('git', ['add', '-f', '--', target], { cwd: root, env: { ...env, ...candidateEnv } });
        execFileSync('git', ['commit', '-qm', 'fixture deliberately changes sealed index'], { cwd: root, env: { ...env, ...candidateEnv } });
      } }), { code: 'ATM_COMMIT_ATTRIBUTION_MISMATCH' });
    assert.equal(readFileSync(path.join(root, target), 'utf8'), 'foreign index bytes\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
