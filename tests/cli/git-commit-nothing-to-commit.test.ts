import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A quickfix commit with no change in the claimed files used to fail as
// ATM_GIT_COMMIT_FAILED with nested error "UNKNOWN" and a retry command that
// can only fail again. It must say that there is nothing to commit.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (result: { messages?: { code: string }[] }) => (result.messages ?? []).map((entry) => entry.code);

const root = mkdtempSync(path.join(os.tmpdir(), 'nothing-to-commit-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  writeFileSync(path.join(project, 'src', 'a.js'), 'export const x = 1;\n');
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['init']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  atm(project, ['identity', 'set', '--actor', 'ai-a', '--git-name', 'AI A', '--git-email', 'ai-a@example.com']);
  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--prompt', 'quick fix: change x in src/a.js']);
  assert.ok(codes(claimed).includes('ATM_NEXT_QUICKFIX_CLAIMED'), codes(claimed).join(','));
  const head = git(project, ['rev-parse', 'HEAD']).stdout.trim();

  const commit = ['git', 'commit', '--actor', 'ai-a', '--message', 'fix: x', '--auto-stage'];
  const empty = atm(project, commit);
  assert.equal(empty.ok, false);
  assert.ok(codes(empty).includes('ATM_GIT_COMMIT_NOTHING_TO_COMMIT'), `an unchanged claim says there is nothing to commit, got ${codes(empty).join(',')}`);
  assert.equal(git(project, ['rev-parse', 'HEAD']).stdout.trim(), head, 'no commit was created');

  writeFileSync(path.join(project, 'src', 'a.js'), 'export const x = 2;\n');
  const landed = atm(project, commit);
  assert.ok(codes(landed).includes('ATM_GIT_COMMIT_OK'), `the same command commits once the file changed, got ${codes(landed).join(',')}`);
  assert.match(git(project, ['show', '--name-only', '--format=', 'HEAD']).stdout, /src\/a\.js/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a commit with no claimed change says there is nothing to commit');
