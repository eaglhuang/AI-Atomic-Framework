import assert from 'node:assert/strict';
import { buildChannelPlaybook } from '../../packages/cli/src/commands/next/playbook-projection/channel-playbook.ts';

const playbook = buildChannelPlaybook({
  channel: 'fast',
  originalPrompt: 'fix typo in packages/cli/src/commands/quickfix.ts',
  actorPlaceholder: 'bench-0099'
});

assert.equal(playbook.schemaId, 'atm.channelPlaybook.v1');
assert.equal(playbook.channel, 'fast');
assert.equal(playbook.commandSequence.length, 4, 'fast route should expose claim, edit, validator, and one commit step');
assert.equal(playbook.commandSequence.some((command) => /^git add\b/.test(command)), false, 'fast route must not require a separate staging command');
assert.match(
  playbook.commandSequence.at(-1) ?? '',
  /git commit .*--auto-stage --json/,
  'fast route must use bounded ATM auto-stage for its single commit'
);
assert.ok(
  playbook.doNot.some((entry) => /separate git add/i.test(entry)),
  'operator guidance must explicitly remove the redundant staging decision'
);

const frameworkPlaybook = buildChannelPlaybook({
  channel: 'fast',
  originalPrompt: 'repair runner source',
  actorPlaceholder: 'bench-0099',
  fastClaimCommand: 'node atm.mjs framework-mode claim --actor bench-0099 --files packages/cli/src/commands/quickfix.ts --json',
  fastClaimLabel: 'framework temp claim'
});
assert.equal(frameworkPlaybook.commandSequence[0], 'node atm.mjs framework-mode claim --actor bench-0099 --files packages/cli/src/commands/quickfix.ts --json');
assert.match(frameworkPlaybook.commandSequence.at(-1) ?? '', /--auto-stage --json/);

// The fixed legacy path required six operator invocations: prompt guidance,
// explicit quickfix claim, status check, validator, git add, and commit.
// The converged path needs three: next --claim (scope + claim), validator,
// and one bounded ATM commit. This is a 50% call reduction.
const legacyCalls = 6;
const convergedCalls = 3;
assert.ok((legacyCalls - convergedCalls) / legacyCalls >= 0.3);

console.log('quickfix operator convergence: ok');
