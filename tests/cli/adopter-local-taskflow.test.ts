import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A single-repository adopter opens, delivers and closes its own task card in
// docs/tasks with only published commands: bootstrap writes the profile and
// taskflow open uses ATM's built-in opener (no planning repo, no opener script).
// Every ATM command runs in a fresh process without ATM_LANE_SESSION_ID, as an
// agent shell does; the lane travels only as the playbook's --lane-session.
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
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const splitCommand = (command: string) => command.replace(/^node atm\.mjs /, '').replace(/ --json$/, '').match(/"[^"]*"|\S+/g)!.map((part) => part.replace(/^"|"$/g, ''));

const root = mkdtempSync(path.join(os.tmpdir(), 'local-taskflow-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Newcomer']);
  git(cwd, ['config', 'user.email', 'newcomer@example.com']);
  const bootstrap = atm(cwd, ['bootstrap']);
  assert.equal(bootstrap.json.evidence.taskflowProfile.status, 'created');
  const profile = readJson(path.join(cwd, 'taskflow.profile.json'));
  assert.equal(profile.delegation.openerPath, 'atm:builtin');
  assert.equal(profile.taskId.format, 'TASK-SHOP-NNNN');
  assert.equal(atm(cwd, ['bootstrap']).json.evidence.taskflowProfile.status, 'existing');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);

  assert.equal(atm(cwd, ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Add dark mode toggle']).exitCode, 2,
    'the built-in opener refuses a card without scope and validators');
  const open = atm(cwd, ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Add dark mode toggle',
    '--goal', 'Users can switch the settings page to dark mode.',
    '--scope-path', 'src/settings.js,scripts/check-settings.mjs', '--validator', 'node scripts/check-settings.mjs']);
  assert.equal(open.exitCode, 0, JSON.stringify(open.json.messages));
  const taskId = 'TASK-SHOP-0001';
  const cardPath = path.join(cwd, 'docs', 'tasks', `${taskId}.task.md`);
  const card = readFileSync(cardPath, 'utf8');
  assert.match(card, /^owner: newcomer$/m);
  assert.match(card, /^target_repo: shop$/m);
  assert.doesNotMatch(card, /AI-Atomic-Framework|atm-core|RFT-M|tests\/main\.test\.ts/, 'the adopter card carries no framework-repository values');

  atm(cwd, ['identity', 'set', '--actor', 'newcomer', '--git-name', 'Newcomer', '--git-email', 'newcomer@example.com']);
  const claim = atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--task', taskId, '--auto-intent']);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));
  const playbook = claim.json.evidence.nextAction.playbook;
  assert.ok(!playbook.commandSequence.some((command: string) => command.includes('next --claim')), 'an active claim is not repeated');
  assert.ok(!playbook.commandSequence.some((command: string) => command.includes('<task-id>')), 'the claimed task id is filled in');
  const lane = playbook.closePreview.writeCommand.match(/--lane-session (\S+)/)?.[1];
  assert.ok(lane, 'the playbook carries the claim lane as --lane-session');
  const withLane = (args: string[]) => (args.includes('--lane-session') ? args : [...args, '--lane-session', lane!]);

  mkdirSync(path.join(cwd, 'src'));
  mkdirSync(path.join(cwd, 'scripts'));
  writeFileSync(path.join(cwd, 'src', 'settings.js'), 'export const darkMode = true;\n');
  writeFileSync(path.join(cwd, 'scripts', 'check-settings.mjs'), "import { darkMode } from '../src/settings.js';\nif (darkMode !== true) process.exit(1);\nconsole.log('settings: 1 case passed');\n");
  const commit = atm(cwd, withLane(['git', 'commit', '--actor', 'newcomer', '--task', taskId, '--message', 'feat: dark mode toggle', '--auto-stage']));
  assert.equal(commit.exitCode, 0, JSON.stringify(commit.json.messages));
  const evidence = atm(cwd, withLane(['evidence', 'run', '--task', taskId, '--actor', 'newcomer', '--command', 'node scripts/check-settings.mjs', '--validators', 'node scripts/check-settings.mjs']));
  assert.equal(evidence.exitCode, 0, JSON.stringify(evidence.json.messages));

  // Follow the close preview's own requiredCommand, as an agent would.
  const preview = atm(cwd, splitCommand(playbook.closePreview.dryRunCommand));
  const required = (preview.json.evidence.writeReadinessHint?.blockers ?? []).map((entry: { requiredCommand?: string }) => entry.requiredCommand).find((command: string | undefined) => command?.includes('--write'));
  const close = atm(cwd, withLane(splitCommand(required ?? playbook.closePreview.writeCommand)));
  assert.equal(close.exitCode, 0, JSON.stringify(close.json.messages));
  assert.equal(readJson(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`)).status, 'done');
  assert.match(readFileSync(cardPath, 'utf8'), /^status: done$/m);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a single-repository adopter opens, delivers and closes a local task card across fresh processes');
