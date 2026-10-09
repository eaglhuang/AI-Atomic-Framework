import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyLaneSessionFlagFromArgv, carryLaneSessionIntoPrintedCommands } from '../../packages/cli/src/commands/shared/lane-session-flag.ts';

// Unit: only commands for the same actor that lack a lane are rewritten.
applyLaneSessionFlagFromArgv(['taskflow', 'close', '--task', 'T-1', '--actor', 'ai-a', '--lane-session', 'lane-1', '--json']);
const rewritten = carryLaneSessionIntoPrintedCommands({
  a: 'node atm.mjs taskflow close --task T-1 --actor "ai-a" --historical-delivery abc --write --json',
  b: 'node atm.mjs evidence run --task T-1 --actor ai-a --command "node --check x.js" --json',
  c: 'node atm.mjs next --claim --actor ai-b --task T-2 --json',
  d: 'node atm.mjs taskflow close --task T-1 --actor ai-a --lane-session lane-0 --json',
  e: ['node atm.mjs tasks renew --task T-1 --actor ai-a --json'],
  f: 'run the tests'
});
assert.equal(rewritten.a, 'node atm.mjs taskflow close --task T-1 --actor "ai-a" --historical-delivery abc --write --lane-session lane-1 --json');
assert.equal(rewritten.b, 'node atm.mjs evidence run --task T-1 --actor ai-a --command "node --check x.js" --lane-session lane-1 --json');
assert.equal(rewritten.c, 'node atm.mjs next --claim --actor ai-b --task T-2 --json', 'another actor keeps its own command');
assert.equal(rewritten.d, 'node atm.mjs taskflow close --task T-1 --actor ai-a --lane-session lane-0 --json', 'an existing lane is kept');
assert.deepEqual(rewritten.e, ['node atm.mjs tasks renew --task T-1 --actor ai-a --lane-session lane-1 --json']);
assert.equal(rewritten.f, 'run the tests');
applyLaneSessionFlagFromArgv(['next', '--json']);
assert.equal(carryLaneSessionIntoPrintedCommands('node atm.mjs evidence run --task T-1 --actor ai-a --json'), 'node atm.mjs evidence run --task T-1 --actor ai-a --json', 'no lane on this invocation: nothing changes');

// End to end: the close dry-run blocker commands, run exactly as printed in a
// fresh process, close the card.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const env = { ...process.env, ATM_LANE_SESSION_ID: '', ATM_ACTOR_ID: '', AGENT_IDENTITY: '' };
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify(args)], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split(/\r?\n/).filter((line) => !/^\(node:\d+\)|^\(Use `node/.test(line)).join('\n');
  return JSON.parse(out.slice(out.indexOf('{')));
}
function argvOf(command: string): string[] {
  const tokens = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'atm.mjs'], command);
  return tokens.slice(2);
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'printed-lane-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project, '--json']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  atm(project, ['identity', 'set', '--actor', 'ai-a', '--git-name', 'AI A', '--git-email', 'ai-a@example.com', '--json']);
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Add a', '--goal', 'Add a', '--scope-path', 'src/a.js', '--validator', 'node --check src/a.js', '--json']);
  const taskId = opened.evidence.generation.taskId as string;
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'card', '--no-verify']);
  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId, '--json']);
  const lane = JSON.stringify(claimed).match(/lane-\d+-ai-a-[0-9a-f]+/)?.[0] ?? '';
  writeFileSync(path.join(project, 'src', 'a.js'), 'export const a = 1;\n');
  assert.equal(atm(project, ['git', 'commit', '--actor', 'ai-a', '--task', taskId, '--message', 'feat: a', '--auto-stage', '--lane-session', lane, '--json']).ok, true);

  const dry = atm(project, ['taskflow', 'close', '--task', taskId, '--actor', 'ai-a', '--lane-session', lane, '--json']);
  const blockers = (dry.evidence?.writeReadinessHint?.blockers ?? []) as { requiredCommand?: string | null }[];
  const commands = blockers.map((blocker) => blocker.requiredCommand).filter((command): command is string => Boolean(command));
  assert.ok(commands.length > 0, JSON.stringify(dry.messages));
  for (const command of commands) assert.match(command, new RegExp(`--lane-session ${lane}`), command);
  // Evidence first, then the close write, each exactly as printed.
  for (const command of [...commands].sort((left) => (left.includes(' evidence run ') ? -1 : 1))) {
    const run = atm(project, argvOf(command));
    assert.equal(run.ok, true, `${command}\n${JSON.stringify(run.messages)}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: commands printed for the same actor carry the invocation lane');
