import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A governed commit only takes the claimed files. Edits outside the claim
// used to stay behind silently, so an agent believed every change landed.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (run.stdout ?? '').includes('{') ? run.stdout : run.stderr ?? '';
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
type Result = { messages?: { code: string; data?: { files?: string[] } }[] };
const leftBehind = (result: Result) => result.messages?.find((entry) => entry.code === 'ATM_GIT_COMMIT_CHANGES_LEFT_UNCOMMITTED');

const root = mkdtempSync(path.join(os.tmpdir(), 'commit-left-behind-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  atm(project, ['identity', 'set', '--actor', 'ai-a', '--git-name', 'AI A', '--git-email', 'ai-a@example.com']);

  // Quickfix path: the lock covers src/a.js only.
  atm(project, ['next', '--claim', '--actor', 'ai-a', '--prompt', 'quick fix: add a in src/a.js']);
  writeFileSync(path.join(project, 'src', 'a.js'), 'export const a = 1;\n');
  writeFileSync(path.join(project, 'src', 'b.js'), 'export const b = 2;\n');
  const quick = atm(project, ['git', 'commit', '--actor', 'ai-a', '--message', 'feat: a', '--auto-stage']);
  assert.ok((quick.messages ?? []).some((entry: { code: string }) => entry.code === 'ATM_GIT_COMMIT_OK'), JSON.stringify(quick.messages));
  assert.deepEqual(leftBehind(quick)?.data?.files, ['src/b.js'], 'the quickfix commit names the file it left behind');
  assert.match(git(project, ['status', '--porcelain']).stdout, /\?\? src\/b\.js/);

  // A commit with nothing left behind stays quiet.
  rmSync(path.join(project, 'src', 'b.js'));
  atm(project, ['next', '--claim', '--actor', 'ai-a', '--prompt', 'quick fix: change a in src/a.js']);
  writeFileSync(path.join(project, 'src', 'a.js'), 'export const a = 3;\n');
  const clean = atm(project, ['git', 'commit', '--actor', 'ai-a', '--message', 'feat: a3', '--auto-stage']);
  assert.ok((clean.messages ?? []).some((entry: { code: string }) => entry.code === 'ATM_GIT_COMMIT_OK'), JSON.stringify(clean.messages));
  assert.equal(leftBehind(clean), undefined);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a governed commit names the changed files it left behind');
