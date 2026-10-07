import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `atm init` works in a plain folder, but a quickfix ends in a governed
// commit. Outside a Git repository the claim and the commit must say so and
// give the command to fix it, not fail later on an opaque Git exit 128.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (result: { messages?: { code: string }[] }) => (result.messages ?? []).map((entry) => entry.code);
const missing = (result: { messages?: { code: string; data?: Record<string, unknown> }[] }) => result.messages?.find((entry) => entry.code === 'ATM_GIT_REPOSITORY_MISSING');

const root = mkdtempSync(path.join(os.tmpdir(), 'no-git-repo-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  writeFileSync(path.join(project, 'src', 'a.js'), 'export const x = 1;\n');
  atm(project, ['init']);
  const claimPrompt = ['next', '--claim', '--actor', 'ai-a', '--prompt', 'quick fix: change x in src/a.js'];

  const refusedClaim = atm(project, claimPrompt);
  assert.equal(refusedClaim.ok, false);
  const claimGuidance = missing(refusedClaim);
  assert.ok(claimGuidance, `claim names the missing repository, got ${codes(refusedClaim).join(',')}`);
  assert.match(String(claimGuidance.data?.requiredCommand), /^git init/);

  const refusedCommit = atm(project, ['git', 'commit', '--actor', 'ai-a', '--message', 'fix: x', '--auto-stage']);
  assert.equal(refusedCommit.ok, false);
  assert.ok(missing(refusedCommit), `commit names the missing repository, got ${codes(refusedCommit).join(',')}`);

  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'Initial commit', '--no-verify']);
  const claimed = atm(project, claimPrompt);
  assert.ok(codes(claimed).includes('ATM_NEXT_QUICKFIX_CLAIMED'), `claim succeeds once the repository exists, got ${codes(claimed).join(',')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: claim and commit outside a Git repository explain how to create one');
