import assert from 'node:assert/strict';
import { parseRoleProviderOverride } from '../../packages/core/src/team-runtime/provider-selection.ts';

const compact = parseRoleProviderOverride('worker=openai:gpt-5-mini');
assert.deepEqual(compact?.override, {
  providerId: 'openai', modelId: 'gpt-5-mini', sdkId: 'openai', runtimeMode: 'broker-only'
});

const full = parseRoleProviderOverride('worker=openai:gpt-5-mini:responses:real-agent');
assert.deepEqual(full?.override, {
  providerId: 'openai', modelId: 'gpt-5-mini', sdkId: 'responses', runtimeMode: 'real-agent'
});

const emptySdk = parseRoleProviderOverride('worker=openai:gpt-5-mini::real-agent');
assert.deepEqual(emptySdk?.override, {
  providerId: 'openai', modelId: 'gpt-5-mini', sdkId: 'openai', runtimeMode: 'real-agent'
});

assert.equal(parseRoleProviderOverride('=openai:gpt-5-mini:responses:real-agent'), null);
assert.equal(parseRoleProviderOverride('worker=:gpt-5-mini:responses:real-agent'), null);
assert.equal(parseRoleProviderOverride('worker=openai::responses:real-agent'), null);
assert.equal(parseRoleProviderOverride('worker=openai:gpt-5-mini:responses:not-a-mode'), null);
assert.equal(parseRoleProviderOverride('worker=openai:gpt-5-mini:responses:real-agent:extra'), null);

console.log('team-role-provider-parser: ok');
