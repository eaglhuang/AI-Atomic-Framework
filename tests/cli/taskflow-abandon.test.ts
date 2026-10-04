import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `taskflow abandon --write` drops a claimed local card in one governed
// commit: ledger and card both read abandoned, no record of the task is left
// uncommitted, and `next` stays out of incident-safe mode.
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

const root = mkdtempSync(path.join(os.tmpdir(), 'taskflow-abandon-'));
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

  const preview = atm(cwd, ['taskflow', 'abandon', '--task', 'TASK-SHOP-0001', '--actor', 'newcomer', '--reason', 'user changed mind']);
  assert.equal(preview.exitCode, 0, JSON.stringify(preview.json.messages));
  assert.match(preview.json.messages[0].data.requiredCommand, /taskflow abandon --task TASK-SHOP-0001 .*--write/);

  const abandon = atm(cwd, ['taskflow', 'abandon', '--task', 'TASK-SHOP-0001', '--actor', 'newcomer', '--reason', 'user changed mind', '--write', '--lane-session', lane]);
  assert.equal(abandon.exitCode, 0, JSON.stringify(abandon.json.messages));
  assert.equal(JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-SHOP-0001.json'), 'utf8')).status, 'abandoned');
  assert.match(readFileSync(path.join(cwd, 'docs', 'tasks', 'TASK-SHOP-0001.task.md'), 'utf8'), /^status: abandoned$/m);
  const leftovers = git(cwd, ['status', '--porcelain', '--untracked-files=all']).stdout.split(/\r?\n/).filter((line) => line.includes('TASK-SHOP-0001'));
  assert.deepEqual(leftovers, [], 'every record of the abandoned task is committed');
  assert.notEqual(atm(cwd, ['next']).json.evidence.nextAction.status, 'incident-safe-mode');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: taskflow abandon lands the abandoned card and all its records in one commit');
