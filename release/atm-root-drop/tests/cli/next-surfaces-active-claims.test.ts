import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A new agent session that only knows "continue" must learn that a card is
// already claimed, and the named command must resume it with a fresh lane.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const resumable = (json: { messages: Array<{ code: string; data?: Record<string, unknown> }> }) => json.messages.find((entry) => entry.code === 'ATM_NEXT_ACTIVE_CLAIM_RESUMABLE');

const root = mkdtempSync(path.join(os.tmpdir(), 'active-claims-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  await atm(cwd, ['bootstrap']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  assert.equal(resumable((await atm(cwd, ['next'])).json), undefined, 'no hint without a live claim');

  await atm(cwd, ['taskflow', 'open', '--write', '--actor', 'ai', '--title', 'Add dark mode', '--scope-path', 'src/theme.mjs', '--validator', 'node src/theme.mjs']);
  assert.equal((await atm(cwd, ['next', '--claim', '--actor', 'ai', '--task', 'TASK-SHOP-0001', '--auto-intent'])).exitCode, 0);

  for (const args of [['next', '--prompt', 'continue the dark mode work'], ['next']]) {
    const hint = resumable((await atm(cwd, args)).json);
    assert.ok(hint, `${args.join(' ')} names the live claim`);
    assert.equal(hint.data?.requiredCommand, 'node atm.mjs next --claim --actor ai --task TASK-SHOP-0001 --auto-intent --json');
  }
  const resumed = await atm(cwd, ['next', '--claim', '--actor', 'ai', '--task', 'TASK-SHOP-0001', '--auto-intent']);
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.json.messages));
  assert.match(resumed.json.evidence.nextAction.playbook.closePreview.writeCommand, /--lane-session \S+/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: next names live claims and the command that resumes them');
