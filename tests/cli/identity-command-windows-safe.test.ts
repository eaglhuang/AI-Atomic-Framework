import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { runPreCommitHook } = await import('../../packages/cli/src/commands/hook/pre-commit/implementation.ts');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-windows-safe-guidance-'));
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git(['init', '--quiet']);
  git(['config', 'user.name', 'ATM Test']);
  git(['config', 'user.email', 'atm-test@example.invalid']);
  git(['commit', '--allow-empty', '-m', 'bootstrap']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'file.ts'), 'export const value = 1;\n', 'utf8');
  git(['add', 'src/file.ts']);
  const previousActor = process.env.ATM_COMMIT_ACTOR_ID;
  try {
    delete process.env.ATM_COMMIT_ACTOR_ID;
    const result = runPreCommitHook(repo) as any;
    const warning = result.messages.find((entry: any) => entry.code === 'ATM_HOOK_COMMIT_ACTOR_NOT_EXPLICIT');
    assert.ok(warning, 'missing explicit actor must remain diagnosable');
    assert.equal(warning.data.requiredCommand, 'node atm.mjs identity clear --json');
    assert.deepEqual(warning.data.requiredCommands, [
      'node atm.mjs identity clear --json',
      'node atm.mjs identity set --actor <actor-id> --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json',
    ]);
    assert.ok(!warning.data.requiredCommands.some((command: string) => command.includes('&&')));
  } finally {
    if (previousActor === undefined) delete process.env.ATM_COMMIT_ACTOR_ID;
    else process.env.ATM_COMMIT_ACTOR_ID = previousActor;
  }
  console.log('[identity-command-windows-safe.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
