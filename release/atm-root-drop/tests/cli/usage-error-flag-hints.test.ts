import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

// An unknown flag refusal tells the agent how to retry: matching examples,
// the nearest known flag, and the help command.
async function atm(cwd: string, args: string[]) {
  let out = '';
  const io = { stdout: { write(value: string) { out += value; } }, stderr: { write(value: string) { out += value; } } } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--cwd', cwd, '--json'], io);
  return { exitCode, json: JSON.parse(out.slice(out.indexOf('{'))) };
}

const cwd = mkdtempSync(path.join(os.tmpdir(), 'usage-hints-'));
try {
  const scope = await atm(cwd, ['tasks', 'scope', 'add', '--task', 'TASK-X-0001', '--actor', 'a', '--files', 'src/x.ts']);
  assert.equal(scope.exitCode, 2);
  const scopeData = scope.json.messages[0].data;
  assert.equal(scopeData.unsupportedFlag, '--files');
  assert.ok(scopeData.examples.some((example: string) => example.includes('tasks scope add') && example.includes('--add')), JSON.stringify(scopeData));
  assert.equal(scopeData.helpCommand, 'node atm.mjs tasks --help --json');

  const typo = await atm(cwd, ['taskflow', 'open', '--dry-run', '--titel', 'x']);
  assert.equal(typo.json.messages[0].data.didYouMean, '--title', JSON.stringify(typo.json.messages[0]));
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: unknown-flag refusals carry examples, the nearest flag and the help command');
