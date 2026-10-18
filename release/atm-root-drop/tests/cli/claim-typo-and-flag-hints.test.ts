import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A mistyped task id must be reported as unknown with the nearest real ids,
// and a flag the subcommand rejects must not be "corrected" to itself.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'claim-typo-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  await atm(cwd, ['bootstrap']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  await atm(cwd, ['taskflow', 'open', '--write', '--actor', 'ai', '--title', 'Add dark mode', '--scope-path', 'src/theme.mjs', '--validator', 'node src/theme.mjs']);

  const typo = await atm(cwd, ['next', '--claim', '--actor', 'ai', '--task', 'TASK-SHOP-001', '--auto-intent']);
  const notFound = typo.json.messages.find((entry: { code: string }) => entry.code === 'ATM_NEXT_CLAIM_TASK_NOT_FOUND');
  assert.ok(notFound, JSON.stringify(typo.json.messages));
  assert.deepEqual(notFound.data.knownTaskIds, ['TASK-SHOP-0001']);
  assert.equal(notFound.data.requiredCommand, 'node atm.mjs next --claim --actor <id> --task TASK-SHOP-0001 --auto-intent --json');

  const flag = await atm(cwd, ['tasks', 'close', '--task', 'TASK-SHOP-0001', '--actor', 'ai', '--write']);
  const usage = flag.json.messages.find((entry: { code: string }) => entry.code === 'ATM_CLI_USAGE');
  assert.ok(usage, JSON.stringify(flag.json.messages));
  assert.equal(usage.data.didYouMean, undefined, 'a rejected flag is not suggested back');
  assert.match(usage.data.flagNotAcceptedHere, /close does not accept it/);
  assert.ok(usage.data.examples.every((example: string) => example.startsWith('node atm.mjs tasks close ')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: unknown task ids and rejected flags get actionable hints');
