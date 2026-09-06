import assert from 'node:assert/strict';
import { runTeamPaidProviderPreflight } from '../../packages/cli/src/commands/team/provider-preflight.ts';

const calls: string[] = [];
const blocked = await runTeamPaidProviderPreflight({
  enabled: true,
  authorized: true,
  providerIds: ['openai', 'openai', 'anthropic'],
  probe: async (providerId) => {
    calls.push(providerId);
    return { ok: false, failureClass: providerId === 'openai' ? 'quota' : 'billing' };
  }
});
assert.deepEqual(calls, ['openai'], 'quota failure must stop the roster before probing another provider');
assert.equal(blocked.totalRequestCount, 1);
assert.equal(blocked.requiresExplicitContinuation, true);
assert.equal(blocked.failures[0]?.failureClass, 'quota');

const disabledCalls: string[] = [];
const disabled = await runTeamPaidProviderPreflight({
  enabled: false,
  authorized: false,
  providerIds: ['openai'],
  probe: async (providerId) => {
    disabledCalls.push(providerId);
    return { ok: true };
  }
});
assert.equal(disabled.ok, true);
assert.equal(disabled.totalRequestCount, 0);
assert.deepEqual(disabledCalls, [], 'disabled probes must not call a paid provider');

const unauthorized = await runTeamPaidProviderPreflight({
  enabled: true,
  authorized: false,
  providerIds: ['openai'],
  probe: async () => ({ ok: true })
});
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.totalRequestCount, 0);
assert.equal(unauthorized.requiresExplicitContinuation, true);

console.log(JSON.stringify({ ok: true, spec: 'team-provider-preflight-probe.test.ts', assertions: 9 }, null, 2));
