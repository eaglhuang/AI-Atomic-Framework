import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A new adopter following only the published runtime's own guidance must be
// able to land a fast-route quickfix: claim, commit with the existing git identity.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-newcomer-fast-'));
try {
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Newcomer']);
  git(cwd, ['config', 'user.email', 'newcomer@example.com']);
  assert.equal((await atm(cwd, ['bootstrap'])).exitCode, 0);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);

  const prompt = 'quick fix: add a tiny hello script in scripts/hello.mjs';
  const claim = await atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--prompt', prompt]);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));
  assert.equal(claim.json.evidence.nextAction.recommendedChannel, 'fast');

  mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  writeFileSync(path.join(cwd, 'scripts', 'hello.mjs'), "console.log('hello');\n", 'utf8');
  const commitArgs = ['git', 'commit', '--actor', 'newcomer', '--message', 'feat: add hello script', '--auto-stage'];

  // The newcomer's existing git identity is reused; no separate `identity set` step.
  // The actor's quickfix lock is the commit authority; no framework claim is required.
  const commit = await atm(cwd, commitArgs);
  assert.equal(commit.exitCode, 0, `fast-route commit lands: ${JSON.stringify(commit.json.messages)}`);
  assert.match(git(cwd, ['show', '--name-only', '--format=', 'HEAD']).stdout, /scripts\/hello\.mjs/);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: a newcomer lands a fast-route quickfix with only published commands');
