import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A single-repository adopter opens, delivers and closes its own task card in
// docs/tasks with only published commands: bootstrap writes the profile and
// taskflow open uses ATM's built-in opener (no planning repo, no opener script).
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

const root = mkdtempSync(path.join(os.tmpdir(), 'local-taskflow-'));
const cwd = path.join(root, 'shop');
const previousLane = process.env.ATM_LANE_SESSION_ID;
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Newcomer']);
  git(cwd, ['config', 'user.email', 'newcomer@example.com']);
  const bootstrap = await atm(cwd, ['bootstrap']);
  assert.equal(bootstrap.json.evidence.taskflowProfile.status, 'created');
  const profile = readJson(path.join(cwd, 'taskflow.profile.json'));
  assert.equal(profile.delegation.openerPath, 'atm:builtin');
  assert.equal(profile.taskId.format, 'TASK-SHOP-NNNN');
  assert.equal((await atm(cwd, ['bootstrap'])).json.evidence.taskflowProfile.status, 'existing');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);

  const missingScope = await atm(cwd, ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Add dark mode toggle']);
  assert.equal(missingScope.exitCode, 2, 'the built-in opener refuses a card without scope and validators');

  const open = await atm(cwd, ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Add dark mode toggle',
    '--goal', 'Users can switch the settings page to dark mode.',
    '--scope-path', 'src/settings.js,scripts/check-settings.mjs', '--validator', 'node scripts/check-settings.mjs']);
  assert.equal(open.exitCode, 0, JSON.stringify(open.json.messages));
  const taskId = 'TASK-SHOP-0001';
  const cardPath = path.join(cwd, 'docs', 'tasks', `${taskId}.task.md`);
  const card = readFileSync(cardPath, 'utf8');
  assert.match(card, /^owner: newcomer$/m);
  assert.match(card, /^target_repo: shop$/m);
  assert.doesNotMatch(card, /AI-Atomic-Framework|atm-core|RFT-M|tests\/main\.test\.ts/, 'the adopter card carries no framework-repository values');

  await atm(cwd, ['identity', 'set', '--actor', 'newcomer', '--git-name', 'Newcomer', '--git-email', 'newcomer@example.com']);
  const claim = await atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--task', taskId, '--auto-intent']);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));
  process.env.ATM_LANE_SESSION_ID = readJson(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`)).claim.laneSession.laneSessionId;

  mkdirSync(path.join(cwd, 'src'));
  mkdirSync(path.join(cwd, 'scripts'));
  writeFileSync(path.join(cwd, 'src', 'settings.js'), 'export const darkMode = true;\n');
  writeFileSync(path.join(cwd, 'scripts', 'check-settings.mjs'), "import { darkMode } from '../src/settings.js';\nif (darkMode !== true) process.exit(1);\nconsole.log('settings: 1 case passed');\n");
  assert.equal((await atm(cwd, ['git', 'commit', '--actor', 'newcomer', '--task', taskId, '--message', 'feat: dark mode toggle', '--auto-stage'])).exitCode, 0);
  assert.equal((await atm(cwd, ['evidence', 'run', '--task', taskId, '--actor', 'newcomer', '--command', 'node scripts/check-settings.mjs', '--validators', 'node scripts/check-settings.mjs'])).exitCode, 0);

  // Follow the close preview's own requiredCommand, as an agent would.
  const preview = await atm(cwd, ['taskflow', 'close', '--task', taskId, '--actor', 'newcomer']);
  const required = (preview.json.evidence.writeReadinessHint?.blockers ?? []).map((entry: { requiredCommand?: string }) => entry.requiredCommand).find((command: string | undefined) => command?.includes('--write'));
  const closeArgs = required
    ? required.replace(/^node atm\.mjs /, '').replace(/ --json$/, '').match(/"[^"]*"|\S+/g)!.map((part: string) => part.replace(/^"|"$/g, ''))
    : ['taskflow', 'close', '--task', taskId, '--actor', 'newcomer', '--write'];
  const close = await atm(cwd, closeArgs);
  assert.equal(close.exitCode, 0, JSON.stringify(close.json.messages));
  assert.equal(readJson(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`)).status, 'done');
  assert.match(readFileSync(cardPath, 'utf8'), /^status: done$/m);
} finally {
  if (previousLane === undefined) delete process.env.ATM_LANE_SESSION_ID; else process.env.ATM_LANE_SESSION_ID = previousLane;
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a single-repository adopter opens, delivers and closes a local task card');
