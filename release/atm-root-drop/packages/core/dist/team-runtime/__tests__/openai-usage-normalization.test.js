import assert from 'node:assert/strict';
import { extractOpenAIResponsesBillableUsage } from '../providers/openai.js';
const usage = extractOpenAIResponsesBillableUsage({
    model: 'gpt-5-mini-2026-07-16',
    service_tier: 'standard',
    usage: {
        input_tokens: 1234,
        input_tokens_details: {
            cached_tokens: 456
        },
        output_tokens: 78,
        output_tokens_details: {
            reasoning_tokens: 9
        }
    }
});
assert.equal(usage?.schemaId, 'atm.teamProviderBillableUsage.v1');
assert.equal(usage?.providerId, 'openai');
assert.equal(usage?.modelId, 'gpt-5-mini-2026-07-16');
assert.equal(usage?.billingProduct, 'responses-api');
assert.equal(usage?.serviceTier, 'standard');
assert.equal(usage?.region, 'global');
assert.equal(usage?.currency, 'USD');
assert.equal(usage?.inputTokens, 1234);
assert.equal(usage?.cacheReadTokens, 456);
assert.equal(usage?.outputTokens, 78);
assert.equal(usage?.reasoningTokens, 9);
assert.equal(usage?.requestCount, 1);
assert.equal(usage?.retryCount, 0);
assert.equal(usage?.billedFailedOrCancelled, false);
assert.deepEqual(usage?.measurementIncompleteReasons, []);
const incomplete = extractOpenAIResponsesBillableUsage({
    model: 'gpt-5-mini',
    usage: {}
});
assert.deepEqual(incomplete?.measurementIncompleteReasons, ['missing-input-tokens', 'missing-output-tokens']);
console.log('[openai-usage-normalization] ok');
