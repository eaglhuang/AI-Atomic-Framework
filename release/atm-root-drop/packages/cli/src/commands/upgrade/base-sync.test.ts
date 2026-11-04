import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runFrameworkBaseSync } from './base-sync.ts';
import { runIntegrationHookInvocationInProcess } from '../integration-hooks/implementation.ts';

function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-base-sync-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'main');
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'ai-atomic-framework' }));
  for (const file of ['packages/core/src/index.ts', 'packages/cli/src/atm.ts']) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), '// framework\n');
  }
  git('add', '.'); git('commit', '-m', 'base');
  const from = git('rev-parse', 'HEAD');
  writeFileSync(path.join(cwd, 'new.txt'), 'target\n');
  git('add', '.'); git('commit', '-m', 'target');
  const to = git('rev-parse', 'HEAD');
  git('checkout', '--detach', from);
  const run = (extra: string[] = []) => runFrameworkBaseSync(['base-sync', '--cwd', cwd, '--actor', 'test-agent', '--from', from, '--to', to, ...extra]);
  return { cwd, git, from, to, run, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('base-sync imports the pinned descendant and persists a receipt without dirtying the tree', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.ok, true);
    assert.equal(f.git('rev-parse', 'HEAD'), f.to);
    assert.equal(f.git('status', '--porcelain'), '');
    const receipts = readdirSync(path.join(f.cwd, '.git/atm-base-sync'));
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(readFileSync(path.join(f.cwd, '.git/atm-base-sync', receipts[0]), 'utf8'));
    assert.deepEqual([receipt.actor, receipt.from, receipt.to, receipt.status], ['test-agent', f.from, f.to, 'completed']);
  } finally { f.cleanup(); }
});

for (const dirty of ['untracked', 'unstaged', 'staged']) {
  test(`base-sync refuses ${dirty} changes without moving HEAD`, () => {
    const f = fixture();
    try {
      const file = dirty === 'untracked' ? 'local.txt' : 'packages/core/src/index.ts';
      writeFileSync(path.join(f.cwd, file), 'local changes');
      if (dirty === 'staged') f.git('add', file);
      assert.throws(() => f.run(), { code: 'ATM_BASE_SYNC_DIRTY' });
      assert.equal(f.git('rev-parse', 'HEAD'), f.from);
    } finally { f.cleanup(); }
  });
}

test('base-sync rejects wrong HEAD, backward/missing targets, missing actor and option-like targets', () => {
  const f = fixture();
  try {
    assert.throws(() => f.run(['--from', f.to]), { code: 'ATM_BASE_SYNC_HEAD_MISMATCH' });
    assert.throws(() => f.run(['--to', '--force']), { code: 'ATM_CLI_USAGE' });
    assert.throws(() => f.run(['--actor', ' ']), { code: 'ATM_CLI_USAGE' });
    assert.throws(() => f.run(['--to', 'a'.repeat(40)]), { code: 'ATM_BASE_SYNC_GIT_FAILED' });
    assert.throws(() => f.run(['--to', f.from]), { code: 'ATM_BASE_SYNC_TARGET_INVALID' });
    writeFileSync(path.join(f.cwd, 'branch.txt'), 'divergence');
    f.git('add', '.'); f.git('commit', '-m', 'divergent');
    const divergent = f.git('rev-parse', 'HEAD');
    assert.throws(() => f.run(['--from', divergent, '--to', f.from]), { code: 'ATM_BASE_SYNC_GIT_FAILED' });
    assert.equal(f.git('rev-parse', 'HEAD'), divergent);
  } finally { f.cleanup(); }
});

test('base-sync refuses an adopter repository', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.cwd, 'package.json'), '{"name":"adopter"}');
    f.git('add', '.'); f.git('commit', '-m', 'adopter');
    assert.throws(() => f.run(), { code: 'ATM_BASE_SYNC_FRAMEWORK_REQUIRED' });
  } finally { f.cleanup(); }
});


test('CLI routes base-sync to maintenance authority without a source-edit claim', () => {
  const f = fixture();
  try {
    const runner = fileURLToPath(new URL('../../../../../atm.dev.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [runner, 'upgrade', 'base-sync', '--cwd', f.cwd, '--actor', 'downstream-agent', '--from', f.from, '--to', f.to, '--json'], { cwd: f.cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.evidence.status, 'completed');
    assert.equal(f.git('rev-parse', 'HEAD'), f.to);
  } finally { f.cleanup(); }
});


test('editor pre-tool permits governed base-sync but keeps raw merges and declared source edits blocked', () => {
  const f = fixture();
  try {
    const command = `node atm.mjs upgrade base-sync --actor test-agent --from ${f.from} --to ${f.to} --json`;
    const hook = (cmd: string, extra: string[] = []) => runIntegrationHookInvocationInProcess(['pre-tool', '--cwd', f.cwd, '--editor', 'claude-code', '--tool-name', 'Bash', '--command', cmd, ...extra]);
    assert.equal(hook(command).ok, true);
    assert.equal(hook(`git merge --ff-only ${f.to}`).messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');
    assert.equal(hook(command, ['--files', 'packages/core/src/index.ts']).ok, false);
    assert.equal(hook(`${command} && git merge --ff-only ${f.to}`).ok, false);
    assert.equal(hook(`echo ${command}`).ok, false);
    assert.equal(hook(`${command}\nnode -e "process.exit(0)"`).ok, false);
    assert.equal(hook(`git merge ${f.to}`).messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');
    assert.equal(f.git('rev-parse', 'HEAD'), f.from);
  } finally { f.cleanup(); }
});

test('base-sync creates a merge commit when the branch has diverged and still blocks raw git merge', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.cwd, 'branch.txt'), 'divergence\n');
    f.git('add', '.'); f.git('commit', '-m', 'divergent');
    const divergent = f.git('rev-parse', 'HEAD');
    const result = f.run(['--from', divergent]);
    assert.equal(result.ok, true);
    assert.equal(result.evidence.mode, 'merge-commit');
    const head = f.git('rev-parse', 'HEAD');
    assert.deepEqual(f.git('rev-parse', `${head}^1`, `${head}^2`).split(/\s+/), [divergent, f.to]);
    assert.equal(f.git('status', '--porcelain'), '');
    const hook = (cmd: string) => runIntegrationHookInvocationInProcess(['pre-tool', '--cwd', f.cwd, '--editor', 'claude-code', '--tool-name', 'Bash', '--command', cmd]);
    assert.equal(hook(`git merge --no-ff ${f.to}`).messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');
    assert.equal(hook(`node atm.mjs upgrade base-sync --actor test-agent --from ${divergent} --to ${f.to} --json`).ok, true);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
  } finally { f.cleanup(); }
});

test('base-sync aborts a conflicted diverged merge without moving HEAD', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.cwd, 'new.txt'), 'other\n');
    f.git('add', '.'); f.git('commit', '-m', 'conflict');
    const divergent = f.git('rev-parse', 'HEAD');
    assert.throws(() => f.run(['--from', divergent]), { code: 'ATM_BASE_SYNC_GIT_FAILED' });
    assert.equal(f.git('rev-parse', 'HEAD'), divergent);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.cleanup(); }
});
