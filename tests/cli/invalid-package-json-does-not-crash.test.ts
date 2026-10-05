import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectProjectProfile } from '../../packages/language-js/src/language-js-adapter.ts';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// A package.json the user is mid-way through editing must not crash ATM
// (it was ATM_CLI_UNHANDLED "Unexpected non-whitespace character after JSON"
// with no file named) when a card is claimed.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'invalid-package-json-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'shop', scripts: { test: 'node --test' } }, null, 2));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  await atm(cwd, ['bootstrap']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  assert.equal((await atm(cwd, ['taskflow', 'open', '--write', '--actor', 'ai', '--title', 'Add x', '--scope-path', 'src/x.mjs', '--validator', 'npm test'])).exitCode, 0);

  appendFileSync(path.join(cwd, 'package.json'), '// half-edited\n');
  assert.deepEqual(detectProjectProfile(cwd).testCommand, null, 'an unparsable package.json profiles as having no scripts');
  const claim = await atm(cwd, ['next', '--claim', '--actor', 'ai', '--task', 'TASK-SHOP-0001', '--auto-intent']);
  assert.equal(claim.exitCode, 0, JSON.stringify(claim.json.messages));
  assert.ok(!claim.json.messages.some((entry: { code: string }) => entry.code === 'ATM_CLI_UNHANDLED'));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a half-edited package.json does not crash claim');
