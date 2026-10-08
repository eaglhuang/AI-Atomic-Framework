import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// With a card in progress, an unrelated request ("fix the typo in
// README.md") was blocked as divergent and told to rerun next with
// "<specific task id or imported task card>". It must stay unattached to the
// active card but offer a working claim for the new work and a resume route.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Failed results go to stderr; drop Node runtime warning lines around them.
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split(/\r?\n/).filter((line) => !/^\(node:\d+\)|^\(Use `node/.test(line)).join('\n');
  return JSON.parse(out.slice(out.indexOf('{')));
}
function argvOf(command: string): string[] {
  const tokens = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'atm.mjs'], command);
  return tokens.slice(2).filter((token) => token !== '--json');
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'divergence-routes-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# Shop teh app\n');
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Add a', '--goal', 'Add a', '--scope-path', 'src/a.js', '--validator', 'node --check src/a.js']);
  const taskId = opened.evidence.generation.taskId as string;
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'card', '--no-verify']);
  assert.equal(atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId]).ok, true);

  const routed = atm(project, ['next', '--prompt', 'Fix the typo in README.md']);
  const nextAction = routed.evidence.nextAction;
  assert.equal(nextAction.status, 'active-task-divergence-blocked');
  {
    assert.doesNotMatch(nextAction.command, /<specific task id/);
    const resume = nextAction.suggestedRoutes.find((route: { channel: string }) => route.channel === 'resume');
    assert.match(resume.command, new RegExp(`--actor ai-a --task ${taskId}`));
  }
  const fast = nextAction.suggestedRoutes[0].command;
  const claimed = atm(project, argvOf(fast.replace('<id>', 'ai-b')));
  assert.deepEqual(claimed.evidence?.quickfixLock?.allowedFiles, ['README.md'], `the new work can be claimed while ${taskId} stays active: ${JSON.stringify(claimed.messages)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: unrelated work next to an active card gets a working claim and a resume route');
