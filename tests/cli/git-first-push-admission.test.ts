import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateGitAdmission } from '../../packages/core/src/git/admission.ts';
import { runGitPush } from '../../packages/cli/src/commands/git-governance/implementation/push-command.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-first-push-'));
const local = path.join(root, 'local');
const remote = path.join(root, 'origin.git');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  git(root, ['init', '--bare', remote]);
  mkdirSync(local);
  git(local, ['init']);
  git(local, ['config', 'user.name', 'fixture']);
  git(local, ['config', 'user.email', 'fixture@example.invalid']);
  git(local, ['checkout', '-b', 'feature']);
  git(local, ['remote', 'add', 'origin', remote]);
  writeFileSync(path.join(local, 'source.ts'), 'export const value = 1;\n');
  git(local, ['add', 'source.ts']);
  git(local, ['commit', '-m', 'first delivery']);
  const input = { cwd: local, actorId: 'fixture', branch: 'feature', timeoutMs: 10000 };
  const first = evaluateGitAdmission(input);
  assert.equal(first.outcome, 'no-op', JSON.stringify(first.diagnostics));
  assert.match(first.recommendedNextStep, /remote branch.*does not exist/i);
  assert.equal(first.topology.remoteSha, 'absent');
  const preview = runGitPush({ ...input, dryRun: true });
  assert.equal(preview.ok, true);
  assert.equal(git(root, ['--git-dir', remote, 'for-each-ref', 'refs/heads/feature']), '', 'dry-run must not create the branch');
  const published = runGitPush(input);
  assert.equal(published.ok, true);
  assert.equal(published.evidence.hostPush?.exitCode, 0, 'the wrapper must actually push a verified absent branch');
  assert.equal(git(root, ['--git-dir', remote, 'rev-parse', 'refs/heads/feature']), git(local, ['rev-parse', 'HEAD']));
  assert.equal(runGitPush(input).evidence.hostPush, null, 'an already synchronized branch must remain a no-op');
  assert.equal(evaluateGitAdmission(input).outcome, 'no-op', 'retry after branch creation must succeed');
  git(local, ['checkout', '-b', 'second-feature']);
  assert.equal(evaluateGitAdmission({ ...input, branch: 'second-feature' }).outcome, 'no-op',
    'new branch on populated remote must also work');
  const peer = path.join(root, 'peer');
  git(root, ['clone', remote, peer]);
  git(peer, ['checkout', '-b', 'second-feature', 'origin/feature']);
  git(peer, ['config', 'user.name', 'peer']);
  git(peer, ['config', 'user.email', 'peer@example.invalid']);
  writeFileSync(path.join(peer, 'peer.ts'), 'export const peer = true;\n');
  git(peer, ['add', 'peer.ts']);
  git(peer, ['commit', '-m', 'competing ref creation']);
  git(peer, ['push', 'origin', 'second-feature']);
  assert.throws(() => git(local, ['push', 'origin', 'second-feature']),
    'normal Git push must reject a competing ref created after admission');
  git(local, ['remote', 'set-url', 'origin', path.join(root, 'missing-remote.git')]);
  assert.equal(evaluateGitAdmission(input).outcome, 'internal-error', 'inaccessible remote must remain fail-closed');
  const unavailable = runGitPush(input);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.evidence.hostPush, null, 'inaccessible remote must not invoke host push');
  console.log('[git-first-push-admission.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
