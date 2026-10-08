import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// taskflow open --write named --scope-path and --validator as missing even
// when only --actor was absent. The refusal must name what is missing.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', env: { ...process.env, ATM_ACTOR_ID: '', AGENT_IDENTITY: '' }, maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split(/\r?\n/).filter((line) => !/^\(node:\d+\)|^\(Use `node/.test(line)).join('\n');
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const usage = (result: { messages?: { code: string; text: string; data?: { missingFlags?: string[] } }[] }) => result.messages?.find((entry) => entry.code === 'ATM_CLI_USAGE');

const root = mkdtempSync(path.join(os.tmpdir(), 'open-missing-flags-'));
const project = path.join(root, 'shop');
try {
  git(root, ['init', '-q', project]);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  const open = ['taskflow', 'open', '--write', '--title', 'Add a', '--goal', 'Add a'];

  const noActor = usage(atm(project, [...open, '--scope-path', 'src/a.js', '--validator', 'node --check src/a.js']));
  assert.deepEqual(noActor?.data?.missingFlags, ['--actor']);
  assert.match(noActor!.text, /missing --actor <id>\./);

  const noValidator = usage(atm(project, [...open, '--actor', 'ai-a', '--scope-path', 'src/a.js']));
  assert.deepEqual(noValidator?.data?.missingFlags, ['--validator']);

  const nothing = usage(atm(project, open));
  assert.deepEqual(nothing?.data?.missingFlags, ['--actor', '--scope-path', '--validator']);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: taskflow open names only the flags that are missing');
