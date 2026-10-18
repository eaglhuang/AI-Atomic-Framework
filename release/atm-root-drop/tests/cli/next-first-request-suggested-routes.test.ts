import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';

const prompt = 'add a tiny hello script and leave evidence';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-first-request-'));
const savedActor = process.env.ATM_ACTOR_ID;
const savedLegacy = process.env.AGENT_IDENTITY;
delete process.env.ATM_ACTOR_ID;
delete process.env.AGENT_IDENTITY;
try {
  await runBootstrap(['--cwd', cwd, '--json']);
  const guidance = await runNext(['--cwd', cwd, '--prompt', prompt, '--json']);
  const nextAction = (guidance.evidence as Record<string, any>).nextAction;
  assert.equal(nextAction.status, 'prompt-guidance-required');
  assert.ok(Array.isArray(nextAction.suggestedRoutes) && nextAction.suggestedRoutes.length >= 2, 'a first free-text request lists suggested routes');
  assert.match(nextAction.command, /taskflow open /);
  assert.doesNotMatch(nextAction.command, /--write/);
  assert.doesNotMatch(JSON.stringify(nextAction.suggestedRoutes), /<[^>]+>/);
  assert.equal(nextAction.suggestedRoutes.some((route: { channel: string | null }) => route.channel === 'fast'), false, 'a prompt with no files does not offer a placeholder quick-fix claim');
  assert.equal(nextAction.suggestedRoutes.find((route: { channel: string | null }) => route.channel === 'task-card').command, nextAction.command);

  // Filling in the path yields a prompt that ATM routes straight to the fast quickfix channel.
  const filled = `quick fix: ${prompt} in scripts/hello.mjs`;
  const quick = await runNext(['--cwd', cwd, '--prompt', filled, '--json']);
  const quickAction = (quick.evidence as Record<string, any>).nextAction;
  assert.equal(quickAction.status, 'quickfix-actor-required', `an unknown actor is not a one-step claim: ${quickAction.status}`);
  assert.equal(quickAction.pasteReady, false);
  assert.ok(quickAction.missing?.includes('--actor'), JSON.stringify(quickAction.missing));
  assert.match(quickAction.command, /--actor ATM_ACTOR_ID/);
  assert.doesNotMatch(quickAction.command, /[<>]/);
  assert.match(String(quick.messages?.find((entry: { code: string }) => entry.code === 'ATM_NEXT_QUICKFIX_ROUTE_READY')?.text ?? ''), /--actor is missing/);
  assert.equal(quickAction.recommendedChannel, 'fast');
  assert.ok(quickAction.playbook, 'the fast route carries a playbook');
} finally {
  if (savedActor === undefined) delete process.env.ATM_ACTOR_ID;
  else process.env.ATM_ACTOR_ID = savedActor;
  if (savedLegacy === undefined) delete process.env.AGENT_IDENTITY;
  else process.env.AGENT_IDENTITY = savedLegacy;
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: a first free-text request names a claimable fast route');
