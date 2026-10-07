import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// For larger work, next -> guide -> orient/start -> next used to loop with no
// exit, and a successful taskflow open pointed back at taskflow open. A
// newcomer must be able to follow the printed commands to a claimed card.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify(args)], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
// Turn a printed `node atm.mjs ...` command into argv, honoring double quotes.
function argvOf(command: string): string[] {
  const tokens = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'atm.mjs'], command);
  return tokens.slice(2);
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (result: { messages?: { code: string }[] }) => (result.messages ?? []).map((entry) => entry.code);

const root = mkdtempSync(path.join(os.tmpdir(), 'larger-work-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project, '--json']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);

  const routed = atm(project, ['next', '--prompt', 'Add a checkout module in src/checkout.js with tax calculation', '--json']);
  const cardRoute = routed.evidence.nextAction.suggestedRoutes.find((route: { channel: string }) => route.channel === 'task-card');
  assert.ok(cardRoute, 'larger work is offered a task-card route');
  assert.match(cardRoute.command, /taskflow open --write .*--scope-path "src\/checkout\.js"/);

  const openCommand = cardRoute.command.replace('<id>', 'ai-a').replace('"<command>"', '"node --check src/checkout.js"');
  const opened = atm(project, argvOf(openCommand));
  assert.equal(opened.ok, true, codes(opened).join(','));
  const claimCommand = opened.evidence.nextAction?.command as string;
  assert.match(claimCommand, /^node atm\.mjs next --claim --actor "?ai-a"? --task TASK-[A-Z0-9-]+ --json$/, `taskflow open names the claim as the next step, got ${claimCommand}`);
  assert.doesNotMatch(String(opened.evidence.writeReadinessHint?.nextCommand), /taskflow open/);

  const claimed = atm(project, argvOf(claimCommand));
  assert.equal(claimed.ok, true, `the printed claim works, got ${codes(claimed).join(',')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: larger work follows printed commands from next to a claimed task card');
