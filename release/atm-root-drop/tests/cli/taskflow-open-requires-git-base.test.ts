import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A card opened before the first commit records no repository identity and
// can never be claimed. taskflow open --write refuses first and names the
// command that creates the base commit; following it opens and claims.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const open = ['taskflow', 'open', '--write', '--actor', 'newcomer', '--title', 'Add x', '--scope-path', 'src/x.mjs', '--validator', 'node src/x.mjs'];

const root = mkdtempSync(path.join(os.tmpdir(), 'git-base-'));
try {
  const cwd = path.join(root, 'shop');
  mkdirSync(cwd);
  await atm(cwd, ['bootstrap']);
  const refused = await atm(cwd, open);
  assert.equal(refused.exitCode, 2);
  assert.equal(refused.json.messages[0].code, 'ATM_TASKFLOW_OPEN_GIT_BASE_MISSING');
  const required = refused.json.messages[0].data.requiredCommand;
  assert.match(required, /^git init && git add -A && git commit -m "Initial commit"$/);
  assert.equal(existsSync(path.join(cwd, 'docs', 'tasks')), false, 'no card is written without a base commit');

  execSync(required, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'N', GIT_AUTHOR_EMAIL: 'n@example.com', GIT_COMMITTER_NAME: 'N', GIT_COMMITTER_EMAIL: 'n@example.com' } });
  assert.equal((await atm(cwd, open)).exitCode, 0);
  const claim = await atm(cwd, ['next', '--claim', '--actor', 'newcomer', '--task', 'TASK-SHOP-0001', '--auto-intent']);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));

  const empty = path.join(root, 'empty');
  mkdirSync(empty);
  spawnSync('git', ['init', '-q'], { cwd: empty });
  await atm(empty, ['bootstrap']);
  assert.equal((await atm(empty, open)).json.messages[0].data.requiredCommand, 'git add -A && git commit -m "Initial commit"');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: taskflow open requires a base commit and names how to create it');
