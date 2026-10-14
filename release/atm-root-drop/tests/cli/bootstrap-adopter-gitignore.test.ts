import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// Bootstrap ignores ATM's per-machine runtime state in an adopter repo, keeps
// the user's own rules, stays idempotent, and still lets the fast route commit.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-adopter-gitignore-'));
try {
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Newcomer']);
  git(cwd, ['config', 'user.email', 'newcomer@example.com']);
  writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n', 'utf8');

  const bootstrap = await atm(cwd, ['bootstrap']);
  assert.equal(bootstrap.exitCode, 0);
  assert.equal(bootstrap.json.evidence.gitignore.status, 'appended');
  const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
  assert.ok(gitignore.startsWith('node_modules/\n'), 'user rules are kept');
  assert.match(gitignore, /^\.atm\/runtime\/locks\/$/m);
  assert.match(gitignore, /^\.atm\/runtime\/quickfix-lock\.json$/m);
  assert.match(gitignore, /^node_modules\/$/m, 'the installed ATM CLI dependency is ignored');
  assert.match(gitignore, /^\.atm\/runtime\/lane-sessions\/$/m, 'claim lanes are ignored');

  assert.equal((await atm(cwd, ['bootstrap'])).json.evidence.gitignore.status, 'existing');
  assert.equal(readFileSync(path.join(cwd, '.gitignore'), 'utf8'), gitignore, 'a second bootstrap does not duplicate the block');

  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  const claim = await atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--prompt', 'quick fix: add a tiny hello script in scripts/hello.mjs']);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));
  const playbook = claim.json.evidence.nextAction.playbook;
  assert.ok(!playbook.commandSequence.some((command: string) => command.includes('next --claim')), 'an active claim is not repeated');
  assert.ok(playbook.steps.some((step: string) => step.includes('ATM_GIT_COMMIT_IDENTITY_MISSING')), 'the playbook names the identity remediation');
  assert.equal(git(cwd, ['status', '--porcelain']).stdout.trim(), '', 'claim runtime state is ignored');

  mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  writeFileSync(path.join(cwd, 'scripts', 'hello.mjs'), "console.log('hello');\n", 'utf8');
  await atm(cwd, ['identity', 'set', '--actor', 'newcomer', '--git-name', 'Newcomer', '--git-email', 'newcomer@example.com']);
  const commit = await atm(cwd, ['git', 'commit', '--actor', 'newcomer', '--message', 'feat: add hello script', '--auto-stage']);
  assert.equal(commit.exitCode, 0, `fast-route commit lands: ${JSON.stringify(commit.json.messages)}`);
  assert.match(git(cwd, ['show', '--name-only', '--format=', 'HEAD']).stdout, /scripts\/hello\.mjs/);
  assert.equal(git(cwd, ['status', '--porcelain']).stdout.trim(), '', 'the worktree is clean after the fast-route commit');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

// The framework repository keeps its own .gitignore untouched.
{
  const frameworkLike = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-gitignore-'));
  try {
    writeFileSync(path.join(frameworkLike, 'package.json'), JSON.stringify({ name: 'ai-atomic-framework' }), 'utf8');
    const { ensureAdopterGitignore } = await import('../../packages/cli/src/commands/bootstrap-gitignore.ts');
    assert.equal(ensureAdopterGitignore(frameworkLike).status, 'framework-repository');
  } finally {
    rmSync(frameworkLike, { recursive: true, force: true });
  }
}

console.log('ok: bootstrap ignores adopter runtime state and the fast route still commits');
