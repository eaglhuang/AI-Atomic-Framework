import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';

const prompt = 'add a tiny hello script and leave evidence';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-first-request-'));
try {
  await runBootstrap(['--cwd', cwd, '--json']);
  const guidance = await runNext(['--cwd', cwd, '--prompt', prompt, '--json']);
  const nextAction = (guidance.evidence as Record<string, any>).nextAction;
  assert.equal(nextAction.status, 'prompt-guidance-required');
  assert.ok(Array.isArray(nextAction.suggestedRoutes) && nextAction.suggestedRoutes.length >= 2, 'a first free-text request lists suggested routes');
  const fast = nextAction.suggestedRoutes[0];
  assert.equal(fast.channel, 'fast');
  assert.match(fast.command, /next --claim --actor <id> --prompt "quick fix: add a tiny hello script and leave evidence in <path>" --json$/);
  assert.equal(nextAction.suggestedRoutes[1].command, nextAction.command, 'the second route is the existing guide command');

  // Filling in the path yields a prompt that ATM routes straight to the fast quickfix channel.
  const filled = `quick fix: ${prompt} in scripts/hello.mjs`;
  const quick = await runNext(['--cwd', cwd, '--prompt', filled, '--json']);
  const quickAction = (quick.evidence as Record<string, any>).nextAction;
  assert.equal(quickAction.status, 'quickfix-ready', `the suggested fast route is claimable: ${quickAction.status}`);
  assert.equal(quickAction.recommendedChannel, 'fast');
  assert.ok(quickAction.playbook, 'the fast route carries a playbook');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: a first free-text request names a claimable fast route');
