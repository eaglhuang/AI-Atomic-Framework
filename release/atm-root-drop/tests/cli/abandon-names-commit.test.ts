import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Abandoning a claimed card stages its transition in a close-commit window.
// The result must name the commit that lands it; following that command
// leaves `next` ready instead of incident-safe mode.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
const env = { ...process.env };
delete env.ATM_LANE_SESSION_ID;
delete env.ATM_ACTOR_ID;
function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return { exitCode: run.status, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const splitCommand = (command: string) => command.replace(/^node atm\.mjs /, '').replace(/ --json$/, '').match(/"[^"]*"|\S+/g)!.map((part) => part.replace(/^"|"$/g, ''));

const root = mkdtempSync(path.join(os.tmpdir(), 'abandon-commit-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Newcomer']);
  git(cwd, ['config', 'user.email', 'newcomer@example.com']);
  atm(cwd, ['bootstrap']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  atm(cwd, ['identity', 'set', '--actor', 'newcomer', '--git-name', 'Newcomer', '--git-email', 'newcomer@example.com']);
  assert.equal(atm(cwd, ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Try idea', '--scope-path', 'src/idea.mjs', '--validator', 'node src/idea.mjs']).exitCode, 0);
  const claim = atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--task', 'TASK-SHOP-0001', '--auto-intent']);
  const lane = claim.json.evidence.nextAction.playbook.closePreview.writeCommand.match(/--lane-session (\S+)/)[1];

  const abandon = atm(cwd, ['tasks', 'abandon', '--task', 'TASK-SHOP-0001', '--actor', 'newcomer', '--reason', 'user changed mind', '--lane-session', lane]);
  assert.equal(abandon.exitCode, 0, JSON.stringify(abandon.json.messages));
  const nextCommand = abandon.json.evidence.nextCommand;
  assert.match(nextCommand, /^node atm\.mjs git commit --actor "?newcomer"? --task TASK-SHOP-0001 /);
  assert.equal(abandon.json.messages[0].data.requiredCommand, nextCommand);

  const commit = atm(cwd, splitCommand(nextCommand));
  assert.equal(commit.exitCode, 0, JSON.stringify(commit.json.messages));
  assert.equal(atm(cwd, ['next']).json.evidence.nextAction.status !== 'incident-safe-mode', true, 'the committed abandonment is not a cross-task incident');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: abandon names the commit that lands it, and next stays out of incident-safe mode');
